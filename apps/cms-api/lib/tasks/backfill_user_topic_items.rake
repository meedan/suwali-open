# One-off backfill of the topic changes users made before added_by and tombstones existed (SUWALI-1168).
# Replays each topic item's latest change by a user from the audit log: an add records added_by (restoring the
# topic item if Knowledge Service removed it), a removal records a tombstone (removing the topic item if Knowledge
# Service gave it back). Idempotent: re-running finds nothing left to change.
#
# RAILS_ENV=production bundle exec rake backfill_user_topic_items
# Dry run by default (prints the counts only); pass apply=true to actually update.
desc "Backfills added_by and removal tombstones on topic items from the users' changes in the audit log"
task backfill_user_topic_items: :environment do
  def log(message, level: :info)
    puts message
    LogService.log(level, "Rake Task: Backfill user topic items", message)
  end

  # Webhooks log the sender's phone number as the audit user, so only ids of actual users count
  user_changes = ActiveRecord::Base.connection.select_all(ActiveRecord::Base.sanitize_sql([<<~SQL, TopicItem::DATA_SOURCE_ITEM_TYPES])).to_a
    SELECT DISTINCT ON (topic_id, item_type, item_id) operation, log_user_id, topic_id, item_type, item_id
    FROM (
      SELECT l.log_id, l.operation, l.log_user_id,
             (COALESCE(l.new_data, l.old_data)->>'topic_id')::bigint AS topic_id,
             COALESCE(l.new_data, l.old_data)->>'item_type' AS item_type,
             (COALESCE(l.new_data, l.old_data)->>'item_id')::bigint AS item_id
      FROM audit.topic_items_log l
      JOIN users u ON u.id = l.log_user_id
      WHERE l.operation IN ('INSERT', 'DELETE')
    ) changes
    WHERE item_type IN (?)
    ORDER BY topic_id, item_type, item_id, log_id DESC
  SQL

  apply = ENV["apply"] == "true"
  started = Time.now
  counts = Hash.new(0)
  log "[#{Time.now}] #{user_changes.size} topic item(s) changed by users to process#{" (dry run)" unless apply}"

  user_changes.each do |change|
    item = change["item_type"].constantize.find_by(id: change["item_id"])
    topic = item&.hub&.topics&.find_by(id: change["topic_id"])
    topic_item = topic.topic_items.find_by(item: item) if topic

    if topic.nil?
      counts[:skipped] += 1
    elsif change["operation"] == "INSERT"
      if topic_item&.added_by_id
        counts[:skipped] += 1
      else
        if apply
          topic_item ||= topic.topic_items.new(item: item, skip_notifications: true)
          topic_item.added_by_id = change["log_user_id"]
          topic_item.save!
        end
        counts[:added] += 1
      end
    elsif topic.deleted_topic_items.exists?(item: item)
      counts[:skipped] += 1
    else
      if apply
        topic.deleted_topic_items.create!(item: item)
        topic_item&.delete
      end
      counts[:removed] += 1
    end

    print "."
  rescue => e
    counts[:errors] += 1
    error_msg = "\n[ERROR] Failed to backfill #{change["item_type"]} #{change["item_id"]} topic #{change["topic_id"]}: #{e.message}"
    puts error_msg
    LogService.log(:error, "Rake Task: Backfill user topic items", error_msg)
  end

  elapsed = Time.now - started

  log "\nTotal time: #{(elapsed / 60).to_i}m #{(elapsed % 60).to_i}s"
  log "Added:      #{counts[:added]}"
  log "Removed:    #{counts[:removed]}"
  log "Skipped:    #{counts[:skipped]}"
  log "Errors:     #{counts[:errors]}"
  log "Dry run only - no changes made. Re-run with apply=true to apply them." unless apply
end
