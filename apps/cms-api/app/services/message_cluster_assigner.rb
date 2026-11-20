class MessageClusterAssigner
  DEFAULT_THRESHOLD = 0.85

  def initialize(message_id:)
    @message_id = message_id
  end

  def call
    message = Message.find_by(id: @message_id)
    if message.blank? || message.embedding.blank? || !message.user_message?
      LogService.log(:warn, "MessageClusterAssigner", "Message with id #{@message_id} does not exist, has no embedding, or isn't a user message, skipping")
      return
    end

    load_message_attributes(message)

    ApplicationRecord.transaction do
      acquire_hub_lock

      existing = Message.where(id: @message_id).pick(:message_cluster_id)
      return existing if existing.present?

      cluster_id = find_best_cluster

      if cluster_id
        increment_cluster_count(cluster_id)
      else
        cluster_id = create_new_cluster!
      end

      assign_message_to_cluster(cluster_id)

      cluster_id
    end
  end

  private

  def load_message_attributes(message)
    @hub_id = message.hub.id
    @embedding = message.embedding
    @message_text = message.body
  end

  def acquire_hub_lock
    sql = ApplicationRecord.sanitize_sql(["SELECT pg_advisory_xact_lock(?)", @hub_id])
    ApplicationRecord.connection.execute(sql)
  end

  def find_best_cluster
    result = MessageCluster
      .where(hub_id: @hub_id)
      .nearest_neighbors(:centroid_embedding, @embedding, distance: "cosine")
      .first

    return nil unless result
    return nil if (1 - result.neighbor_distance) < DEFAULT_THRESHOLD

    result.id
  end

  def create_new_cluster!
    MessageCluster.create!(
      hub_id: @hub_id,
      centroid_embedding: @embedding,
      original_text: @message_text,
      question_count: 1,
      centroid_message_id: @message_id
    ).id
  end

  def increment_cluster_count(cluster_id)
    MessageCluster.update_counters(cluster_id, question_count: 1, touch: true)
  end

  def assign_message_to_cluster(cluster_id)
    updated = Message
      .where(id: @message_id)
      .update_all(message_cluster_id: cluster_id)

    raise "Failed to update message" if updated.zero?
  end
end
