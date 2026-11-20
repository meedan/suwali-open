class PlatformStatisticsService
  include DateBucketing

  VALID_GROUP_BY = %w[day week month].freeze

  DEFAULTS = {
    "day" => 1.week,
    "week" => 4.weeks,
    "month" => 12.months
  }.freeze

  def initialize(group_by: "week", from: nil, to: nil)
    @group_by = group_by.to_s.in?(VALID_GROUP_BY) ? group_by.to_s : "week"
    @to = to || Time.current.end_of_day
    @from = clamped_from(from || DEFAULTS[@group_by].ago.beginning_of_day)
  end

  def documents_by_sync_status
    rows = Document
      .where(created_at: @from..@to)
      .group(bucket_expression("created_at"), :sync_status)
      .count
    pivot_by_bucket(rows, Document.sync_statuses.keys.index_with { 0 })
  end

  def messages_by_state
    rows = Message
      .where(created_at: @from..@to)
      .group(bucket_expression("created_at"), :state)
      .count
    pivot_by_bucket(rows, Message.states.keys.index_with { 0 })
  end

  def hubs_by_creation_date(creation_dates)
    rows = creation_dates.flat_map { |status, dates|
      dates.select { |date| (@from..@to).cover?(date) }
        .map { |date| [truncate_date(date.to_date), status.to_s] }
    }.tally
    pivot_by_bucket(rows, {"active" => 0, "deleted" => 0})
  end

  def global_counts
    {
      hubs: Hub.count,
      sources: Source.count,
      conversations: Conversation.count,
      users: User.count,
      external_users: ExternalUser.count,
      documents: Document.count,
      messages: Message.count
    }
  end

  # Bucketed by the question, not its reply, so a week reports what the audience asked in it
  def questions_by_answered
    rows = Message
      .external_with_bot_answer_verdict
      .where("messages.created_at": @from..@to)
      .group(bucket_expression("messages.created_at"), Arel.sql("bot_reply.answered"))
      .count
      .transform_keys { |(bucket, answered)| [bucket, answered ? "answered" : "unanswered"] }
    pivot_by_bucket(rows, {"answered" => 0, "unanswered" => 0})
  end

  def average_answer_times
    periods = {
      "all_time" => nil,
      "last_week" => 1.week.ago,
      "last_month" => 1.month.ago
    }

    periods.transform_values do |since|
      base = Message
        .where(direction: :outgoing)
        .where.not(reply_to_id: nil)
      base = base.where(created_at: since..) if since
      average = Arel.sql("(metadata->>'total_duration_ms')::float")

      base.average(average)&.to_f
    end
  end
end
