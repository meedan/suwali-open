class StatisticsService
  include DateBucketing

  VALID_GROUP_BY = %w[day week month range rolling_week].freeze
  DEFAULT_LIMIT = 5
  MAX_LIMIT = 100

  def initialize(hub, from = nil, to = nil, group_by: "day", limit: nil)
    @hub = hub
    @to = to || Time.now.end_of_day
    @from = clamped_from(from || Time.now.ago(3.months).beginning_of_day)
    @group_by = group_by.to_s.in?(VALID_GROUP_BY) ? group_by.to_s : "day"
    @limit = limit.to_i.positive? ? [limit.to_i, MAX_LIMIT].min : DEFAULT_LIMIT
    # Nil keeps the ranking over the hub's whole history rather than the default three months
    @ranking_window = (from || to) ? @from..@to : nil
  end

  def range
    [@from, @to]
  end

  def dashboard
    {
      range: range,
      total_conversations: total_conversations,
      number_of_received_messages: number_of_received_messages,
      number_of_new_conversations: number_of_new_conversations,
      number_of_continued_conversations: number_of_continued_conversations,
      average_timeout_window_interval: average_timeout_window_interval,
      average_timeout_window_message_count: average_timeout_window_message_count,
      unique_end_users: unique_end_users
    }
  end

  def total_conversations
    # Count distinct conversation-day pairs (a conversation with messages on 3 days counts as 3)
    messages_query
      .where("messages.created_at": @from..@to)
      .distinct
      .count("(conversations.id, DATE_TRUNC('day', messages.created_at))")
  end

  def number_of_received_messages
    by_bucket(messages_query.where(direction: "incoming"), "messages.created_at")
  end

  def number_of_continued_conversations
    by_bucket(messages_query, "messages.created_at", "DISTINCT(participant_id, participant_type)")
  end

  def number_of_new_conversations
    by_bucket(conversations_query, "created_at")
  end

  def questions_by_answered
    rows = questions_query
      .group(bucket_expression("messages.created_at"), Arel.sql("bot_reply.answered"))
      .count
      .transform_keys { |(bucket, answered)| [bucket, answered ? "answered" : "unanswered"] }
    pivot_by_bucket(rows, {"answered" => 0, "unanswered" => 0})
  end

  def contributions_by_contributor
    pivot_by_bucket(contributions_by_contributor_query, {"returning" => 0, "new" => 0})
  end

  def message_data_source_items_ranking
    message_data_source_items_ranking_query
  end

  def questions_ranking(answered)
    questions_ranking_query(answered)
  end

  def top_topics(limit = @limit)
    counts = topic_messages_per_bucket_query
    return [] if counts.empty?

    messages = series_by_key(counts)
    topics = @hub.topics.where(id: messages.keys).index_by(&:id)
    # Ranked over the whole range rather than the last bucket, so a caller asking for a series gets
    # every topic active in the period, not only the ones asked about again in its final bucket.
    top_ids = messages
      .sort_by { |topic_id, series| [-series.values.sum, topics[topic_id].name] }
      .first(limit)
      .map(&:first)

    data_source_items = series_by_key(data_source_items_per_topic_query(top_ids))

    top_ids.map do |topic_id|
      {
        id: topic_id,
        name: topics[topic_id].name,
        messages: messages[topic_id],
        data_source_items: data_source_items.fetch(topic_id) { empty_series }
      }
    end
  end

  def subscribed_topics(limit = @limit)
    topics = subscribers_per_topic_query(limit)
    return [] if topics.empty?

    documents = series_by_key(documents_per_topic_query(topics.map(&:first)))

    topics.map do |id, name, subscribers|
      {
        id: id,
        name: name,
        subscribers: subscribers,
        documents: documents.fetch(id) { empty_series }
      }
    end
  end

  def average_timeout_window_interval
    average_timeout_window_interval_query
  end

  def average_timeout_window_message_count
    average_timeout_window_message_count_query
  end

  def unique_end_users
    unique_end_users_query
  end

  private

  def conversations_query
    Conversation.not_deleted.where.not(platform: "internal").where(hub_id: @hub.id)
  end

  def messages_query
    Message
      .joins(:conversation)
      .where.not("conversations.platform": "internal")
      .where("conversations.hub_id": @hub.id, "conversations.deleted_at": nil)
  end

  def questions_query
    messages_query
      .external_with_bot_answer_verdict
      .where("messages.created_at": @from..@to)
  end

  def contributions_by_contributor_query
    @hub.contributions
      .where(created_at: @from..@to)
      .group(bucket_expression("contributions.created_at"), :first_time_contributor)
      .count
      .transform_keys { |(bucket, is_first)| [bucket, is_first ? "new" : "returning"] }
  end

  def message_data_source_items_ranking_query
    base = MessageDataSourceItem
      .strict_loading
      .joins(message: :conversation)
      .where.not(conversations: {platform: "internal"})
      .where(conversations: {hub_id: @hub.id, deleted_at: nil})
      .joins(<<~SQL)
        LEFT JOIN contributions
          ON message_data_source_items.item_type = 'Contribution'
        AND message_data_source_items.item_id = contributions.id
        LEFT JOIN documents
          ON message_data_source_items.item_type = 'Document'
        AND message_data_source_items.item_id = documents.id
        LEFT JOIN notebooks
          ON message_data_source_items.item_type = 'Notebook'
        AND message_data_source_items.item_id = notebooks.id
      SQL

    ranked = base
      .select(
        :item_type,
        :item_id,
        :item_title,
        Arel.sql("COUNT(*) AS usage_count"),
        Arel.sql(<<~ACTIVE_SQL.squish),
          COALESCE(
            contributions.active,
            documents.active,
            notebooks.active
          ) AS active
        ACTIVE_SQL
        Arel.sql(<<~PRIORITY_SQL.squish)
          COALESCE(
            contributions.priority_tier,
            documents.priority_tier,
            notebooks.priority_tier
          ) AS priority_tier
        PRIORITY_SQL
      )
      .group(
        :item_type,
        :item_id,
        :item_title,
        Arel.sql(
          "contributions.active,
          documents.active,
          notebooks.active,
          contributions.priority_tier,
          documents.priority_tier,
          notebooks.priority_tier"
        )
      )
      .order(Arel.sql("usage_count DESC, item_title ASC"))

    total_count = base.count(
      Arel.sql("DISTINCT (item_type, item_id, item_title)")
    )

    [ranked, total_count]
  end

  # Only questions the bot actually answered: a Knowledge Service failure replies with an error and
  # cites nothing, so counting it as demand would show a topic that no document could ever cover.
  # Both series build on this, so they always describe the same set of questions.
  def topic_tagged_messages_query
    messages_query
      .where(direction: "incoming")
      .where("messages.created_at": @from..@to)
      .joins("INNER JOIN topic_items ON topic_items.item_type = 'Message' AND topic_items.item_id = messages.id")
      .joins("INNER JOIN messages answers ON answers.reply_to_id = messages.id AND answers.answered = TRUE")
  end

  def topic_messages_per_bucket_query
    topic_tagged_messages_query
      .group("topic_items.topic_id", bucket_expression("messages.created_at"))
      .count
  end

  # Whatever answered this topic's messages, regardless of how those items are tagged themselves:
  # the Knowledge Service tags questions and documents independently, so a document that plainly
  # answered a question often shares none of its topics.
  # Distinct per bucket, so buckets do not sum: use group_by=range for a whole-period total.
  def data_source_items_per_topic_query(topic_ids)
    topic_tagged_messages_query
      .where("topic_items.topic_id": topic_ids)
      .joins("INNER JOIN message_data_source_items ON message_data_source_items.message_id = answers.id")
      .group("topic_items.topic_id", bucket_expression("messages.created_at"))
      .count(Arel.sql("DISTINCT (message_data_source_items.item_type, message_data_source_items.item_id)"))
  end

  # Every subscriber the topic has now, not only the ones who subscribed inside the range: someone
  # who subscribed months ago is still waiting for the next document.
  def subscribers_per_topic_query(limit)
    @hub.topics
      .joins(:topic_subscriptions)
      .group("topics.id")
      .order(Arel.sql("COUNT(topic_subscriptions.id) DESC"), :name)
      .limit(limit)
      .pluck(Arel.sql("topics.id, topics.name, COUNT(topic_subscriptions.id)"))
  end

  # Only public-source documents notify subscribers, so nothing else counts as the topic going
  # quiet. Bucketed by when the document was tagged with the topic rather than when the document
  # was created: that is the moment the notification went out.
  def documents_per_topic_query(topic_ids)
    TopicItem
      .where(topic_id: topic_ids, item_type: "Document", item_id: Document.public_source.where(source: @hub.sources))
      .where(created_at: @from..@to)
      .group("topic_items.topic_id", bucket_expression("topic_items.created_at"))
      .count
  end

  def questions_ranking_query(answered)
    counted = Message
      .where("messages.message_cluster_id = message_clusters.id")
      .in_live_conversations
      .external_with_answered_bot_reply(answered)
    counted = counted.where(created_at: @ranking_window) if @ranking_window
    subquery = counted.select("COUNT(DISTINCT messages.id)").to_sql

    with_counts = MessageCluster
      .where(hub_id: @hub.id)
      .with_last_external_message_answered(answered, @ranking_window)
      .select(:id, :original_text, :centroid_message_id,
        Arel.sql("(#{subquery}) AS question_count"))

    base = MessageCluster
      .from("(#{with_counts.to_sql}) AS message_clusters")
      .where("question_count > 0")

    total_count = base.count
    collection = base
      .select(:id, :original_text, :centroid_message_id, :question_count)
      .order("question_count DESC, message_clusters.id ASC")

    [collection, total_count]
  end

  # Shared CTE for timeout windows to avoid duplication across related queries
  def timeouts_cte_sql
    <<~SQL.squish
      WITH timeouts AS (
        SELECT
          m.id,
          m.conversation_id,
          m.created_at as timeout_at,
          LAG(m.created_at) OVER (
            PARTITION BY m.conversation_id
            ORDER BY m.created_at
          ) as prev_timeout_at
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE m.state = 9
          AND c.hub_id = ?
          AND c.deleted_at IS NULL
          AND c.platform != 0
          AND m.created_at BETWEEN ? AND ?
      )
    SQL
  end

  def average_timeout_window_interval_query
    # platform is stored as an enum, internal = 0
    # This calculates "window duration": time from first message in window (after previous timeout
    # or conversation start) to the last message BEFORE the timeout (excludes the timeout itself)
    # Only includes windows where the window_start is within the date range to avoid weird results
    sql = ActiveRecord::Base.sanitize_sql_array([<<~SQL.squish, @hub.id, @from, @to, @from, @to])
      #{timeouts_cte_sql},
      window_durations AS (
        SELECT
          t.conversation_id,
          t.timeout_at,
          (
            SELECT MIN(m.created_at)
            FROM messages m
            WHERE m.conversation_id = t.conversation_id
              AND m.created_at > COALESCE(t.prev_timeout_at, '1970-01-01'::timestamp)
              AND m.created_at < t.timeout_at
          ) as window_start,
          (
            SELECT MAX(m.created_at)
            FROM messages m
            WHERE m.conversation_id = t.conversation_id
              AND m.created_at > COALESCE(t.prev_timeout_at, '1970-01-01'::timestamp)
              AND m.created_at < t.timeout_at
          ) as last_message
        FROM timeouts t
      )
      SELECT AVG(EXTRACT(EPOCH FROM (last_message - window_start))) as average_seconds
      FROM window_durations
      WHERE window_start IS NOT NULL
        AND last_message IS NOT NULL
        AND window_start BETWEEN ? AND ?
    SQL

    result = ActiveRecord::Base.connection.execute(sql)

    result.first&.fetch("average_seconds", 0)&.to_f || 0
  end

  def average_timeout_window_message_count_query
    # platform is stored as an enum, internal = 0
    # direction is stored as an enum, incoming = 0
    # This calculates "average message count": number of incoming messages in each window
    # (between first message after previous timeout and last message before current timeout)
    # Only includes windows where the window_start is within the date range to avoid weird results
    sql = ActiveRecord::Base.sanitize_sql_array([<<~SQL.squish, @hub.id, @from, @to, @from, @to])
      #{timeouts_cte_sql},
      window_message_counts AS (
        SELECT
          t.conversation_id,
          t.timeout_at,
          (
            SELECT MIN(m.created_at)
            FROM messages m
            WHERE m.conversation_id = t.conversation_id
              AND m.created_at > COALESCE(t.prev_timeout_at, '1970-01-01'::timestamp)
              AND m.created_at < t.timeout_at
          ) as window_start,
          (
            SELECT COUNT(*)
            FROM messages m
            WHERE m.conversation_id = t.conversation_id
              AND m.direction = 0
              AND m.created_at > COALESCE(t.prev_timeout_at, '1970-01-01'::timestamp)
              AND m.created_at < t.timeout_at
          ) as message_count
        FROM timeouts t
      )
      SELECT AVG(message_count) as average_count
      FROM window_message_counts
      WHERE message_count > 0
        AND window_start BETWEEN ? AND ?
    SQL

    result = ActiveRecord::Base.connection.execute(sql)

    result.first&.fetch("average_count", 0)&.to_f || 0
  end

  def unique_end_users_query
    messages_query
      .where("conversations.participant_type": "ExternalUser")
      .where(direction: "incoming")
      .where("messages.created_at": @from..@to)
      .distinct
      .count("conversations.participant_id")
  end
end
