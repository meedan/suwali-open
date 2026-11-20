class TopicSubscriptionSeeder
  POPULAR_TOPICS = 3
  TOPICS_PER_USER = 5

  def initialize(hub)
    @hub = hub
  end

  def seed!
    topics = @hub.topics.to_a
    users = @hub.external_users.to_a
    return 0 if topics.empty? || users.empty?
    return 0 if TopicSubscription.where(topic_id: topics).exists?

    # A few topics everyone subscribes to, so some audience is big enough for the dashboard to
    # report on, and a random handful each for spread
    popular = topics.sample(POPULAR_TOPICS)
    now = Time.current

    rows = users.flat_map do |user|
      (popular + topics.sample(TOPICS_PER_USER)).uniq.map do |topic|
        {topic_id: topic.id, external_user_id: user.id, created_at: now, updated_at: now}
      end
    end

    TopicSubscription.upsert_all(rows, unique_by: :idx_unique_topic_subscription)
    rows.size
  end
end
