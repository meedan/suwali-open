# Writes a snapshot into a target hub: hub ids rewritten, colliding source ids dropped, foreign keys
# pointing outside the snapshot nulled, joins matched on natural keys so a re-run converges. Writes
# bypass callbacks and validations, so no ingestion or delivery is triggered.
class EnduserConversationLoader
  LOG_CONTEXT = "enduser_conversation_snapshot"
  MESSAGE_BATCH_SIZE = 500

  def initialize(hub, data)
    @hub = hub
    @data = data
  end

  # Returns {section => rows_written}, and reports each section as it lands.
  def load
    written = {}

    ActiveRecord::Base.connection.disable_referential_integrity do
      written["external_users"] = upsert(ExternalUser, external_user_rows)
      written["conversations"] = upsert(Conversation, conversation_rows)
      written["messages"] = upsert_in_batches(Message, message_rows)
    end

    reset_sequences

    written["topics"] = resolve_topics
    written["topic_items"] = upsert(TopicItem, topic_item_rows, unique_by: :idx_unique_topic_item)
    # Before the citations, which need these ids.
    written["contributions"] = insert(Contribution, contribution_rows)
    written["message_data_source_items"] = upsert(MessageDataSourceItem, data_source_item_rows, unique_by: :idx_unique_message_item)

    written
  end

  private

  attr_reader :hub, :data

  def upsert(model, rows, unique_by: nil)
    return 0 if rows.empty?

    result = unique_by ? model.upsert_all(rows, unique_by: unique_by) : model.upsert_all(rows)
    log("Upserted #{result.length}/#{rows.size} → #{model.table_name}")
    result.length
  end

  def upsert_in_batches(model, rows)
    count = rows.each_slice(MESSAGE_BATCH_SIZE).sum { |batch| model.upsert_all(batch).length }
    log("Upserted #{count}/#{rows.size} → #{model.table_name}")
    count
  end

  def insert(model, rows)
    return 0 if rows.empty?

    result = model.insert_all(rows)
    log("Inserted #{result.length}/#{rows.size} → #{model.table_name}")
    result.length
  end

  # Only these three keep their staging ids, so only their sequences are left behind the data.
  def reset_sequences
    %w[external_users conversations messages].each { |table| ActiveRecord::Base.connection.reset_pk_sequence!(table) }
  end

  def resolve_topics
    log("Resolved #{topic_ids.size} → topics")
    topic_ids.size
  end

  def log(message)
    LogService.log(:info, LOG_CONTEXT, message)
  end

  def external_user_rows
    data["external_users"].to_a.map { |row| row.merge("hub_id" => hub.id) }
  end

  def conversation_rows
    data["conversations"].to_a.map { |row| row.merge("hub_id" => hub.id) }
  end

  # Clusters are not exported, and a reply pointing outside the snapshot would dangle.
  def message_rows
    @message_rows ||= data["messages"].to_a.map do |row|
      row.merge(
        "message_cluster_id" => nil,
        "reply_to_id" => (snapshot_message_ids.include?(row["reply_to_id"]) ? row["reply_to_id"] : nil)
      )
    end
  end

  def snapshot_message_ids
    @snapshot_message_ids ||= data["messages"].to_a.map { |row| row["id"] }.to_set
  end

  # Topics are matched by name in the target hub, so a snapshot can be imported into a hub that
  # already curates the same topics without duplicating them.
  def topic_ids
    @topic_ids ||= data["topics"].to_a.to_h { |row| [row["id"], hub.topics.find_or_create_by!(name: row["name"]).id] }
  end

  def topic_item_rows
    data["topic_items"].to_a.filter_map do |row|
      topic_id = topic_ids[row["topic_id"]]
      next unless topic_id && snapshot_message_ids.include?(row["item_id"])

      # Drop the source id so we never overwrite an unrelated topic item that already owns it here.
      row.except("id").merge("topic_id" => topic_id)
    end
  end

  # Documents are not exported, so their citations dangle by design; contributions are remapped.
  def data_source_item_rows
    data["message_data_source_items"].to_a.filter_map do |row|
      next unless snapshot_message_ids.include?(row["message_id"])
      next row.except("id") unless row["item_type"] == "Contribution"

      contribution_id = contribution_ids[row["item_id"]]
      next unless contribution_id

      row.except("id").merge("item_id" => contribution_id)
    end
  end

  # Keyed on message_id, which survives the id drop, so a re-import still resolves.
  def contribution_ids
    @contribution_ids ||= begin
      message_by_source_id = data["contributions"].to_a.to_h { |row| [row["id"], row["message_id"]] }
      local_ids = hub.contributions.where(message_id: message_by_source_id.values).pluck(:message_id, :id).to_h

      message_by_source_id.filter_map { |source_id, message_id| [source_id, local_ids[message_id]] if local_ids[message_id] }.to_h
    end
  end

  def contribution_rows
    reject_already_loaded(mapped_contribution_rows)
  end

  # sync_status mirrors Contribution#set_initial_sync_status: pending if active, complete if not.
  def mapped_contribution_rows
    data["contributions"].to_a.filter_map do |row|
      next unless snapshot_message_ids.include?(row["message_id"])

      row.except("id").merge(
        "hub_id" => hub.id,
        "sync_status" => Contribution.sync_statuses[row["active"] ? :pending : :complete],
        "last_sync_error_code" => nil
      )
    end
  end

  def reject_already_loaded(rows)
    already_loaded = hub.contributions.where(message_id: rows.map { |row| row["message_id"] }).pluck(:message_id).to_set
    rows.reject { |row| already_loaded.include?(row["message_id"]) }
  end
end
