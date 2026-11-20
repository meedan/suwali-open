# Chooses what goes into an end-user conversation snapshot: the most recently active end users, plus
# the conversations behind the most recent contributions, which recency alone almost never catches.
class EnduserConversationSampler
  USER_LIMIT = 5
  MESSAGE_LIMIT = 35
  CONTRIBUTION_LIMIT = 5
  CONTRIBUTION_FLOWS_PER_CONVERSATION = 2

  # All four travel together, or the conversation view renders the submission as an orphan node.
  CONTRIBUTION_FLOW_STATES = %w[
    user_contribution_started bot_contribution_started
    user_contribution_submitted bot_contribution_submitted
  ].freeze

  def initialize(hub)
    @hub = hub
  end

  def external_users
    @external_users ||= recently_active_users + contribution_conversations.map(&:participant)
  end

  def conversations
    @conversations ||= recently_active_conversations + contribution_conversations
  end

  def contribution_conversations
    @contribution_conversations ||= additive_conversations(
      hub.contributions.includes(message: :conversation).order(created_at: :desc).map { |contribution| contribution.message.conversation },
      recently_active_user_ids
    )
  end

  def messages
    @messages ||= (recent_messages + contribution_flow_messages).uniq(&:id)
  end

  def topic_items
    @topic_items ||= TopicItem.where(item_type: "Message", item_id: message_ids).to_a
  end

  def topics
    @topics ||= hub.topics.where(id: topic_items.map(&:topic_id)).to_a
  end

  # The documents each answer cited. The dashboard's topic coverage counts these, so without them
  # every topic reads as "0 docs". The referenced items are not exported and will not exist in the
  # target database, which is fine: the association is optional and item_title is denormalized.
  def data_source_items
    @data_source_items ||= MessageDataSourceItem.where(message_id: message_ids).to_a
  end

  def contributions
    @contributions ||= Contribution.where(hub: hub, message_id: message_ids).to_a
  end

  private

  def message_ids
    @message_ids ||= messages.map(&:id)
  end

  attr_reader :hub

  def recently_active_users
    recency_sample.first
  end

  def recently_active_conversations
    recency_sample.last
  end

  def recently_active_user_ids
    @recently_active_user_ids ||= recently_active_users.map(&:id).to_set
  end

  def recency_sample
    @recency_sample ||= pick_active_users(hub.external_users.order(last_message_at: :desc).limit(USER_LIMIT * 10))
  end

  # Candidates must arrive newest-first. Returns [users, their conversations].
  def pick_active_users(candidates)
    users = []
    conversations = []

    candidates.each do |external_user|
      conversation = external_user.conversations.first
      next unless conversation&.messages_count.to_i > 0

      users << external_user
      conversations << conversation
      break if users.size == USER_LIMIT
    end

    [users, conversations]
  end

  def additive_conversations(conversations, sampled_user_ids)
    conversations
      .select { |conv| conv.participant_type == "ExternalUser" && !sampled_user_ids.include?(conv.participant_id) }
      .uniq(&:participant_id)
      .first(CONTRIBUTION_LIMIT)
  end

  def recent_messages
    conversations.flat_map { |conv| conv.messages.order(created_at: :desc).limit(MESSAGE_LIMIT).to_a }
  end

  # Capped per conversation: one prolific contributor otherwise drags in every flow it ever had.
  def contribution_flow_messages
    contribution_conversations.flat_map do |conv|
      conv.messages
        .where(state: CONTRIBUTION_FLOW_STATES)
        .order(created_at: :desc)
        .limit(4 * CONTRIBUTION_FLOWS_PER_CONVERSATION)
        .to_a
    end
  end
end
