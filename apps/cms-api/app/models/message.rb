class Message < ApplicationRecord
  include Anonymizable
  include SoftDeletable::Child
  include NotebookItemable
  include Topicable
  include TrialRestrictable
  include NullByteSanitizable

  # A WhatsApp wamid is base64 that decodes to the sender's phone number.
  anonymizable :external_id

  anonymizable_json :payload, keys: %w[
    id
    from
    from.id
    from.last_name
    from.first_name
    from.username
    from_user_id
    chat.id
    chat.first_name
    chat.last_name
    chat.username
    context.id
    context.from
    message.chat.id
    message.chat.first_name
    message.chat.last_name
    message.chat.username
    message.from
    chat_instance
    image
    reply_to_message
    forward_from
    contact
    From
    To
    ProfileName
    FromCity
    FromState
    FromZip
    FromCountry
    AccountSid
    quote
    contacts
    mentions
    attachments
  ]

  LOADING_STRING = "...".freeze
  INTERMEDIARY_VARIATIONS = 3

  def intermediary_message_text(status)
    tone = hub.tone
    variation = (rand(1_000_000) % INTERMEDIARY_VARIATIONS) + 1
    I18n.with_locale(conversation.language) { I18n.t(:"message_intermediary_#{status}_#{tone}_var_#{variation}") }
  end

  sanitize_null_bytes :body, :metadata

  belongs_to :conversation, counter_cache: true
  belongs_to :message_cluster, optional: true
  has_one :cluster_as_centroid,
    class_name: "MessageCluster",
    foreign_key: :centroid_message_id,
    inverse_of: :centroid_message
  has_one :contribution, dependent: :destroy
  has_many :message_reports, dependent: :destroy
  has_many :message_data_source_items, dependent: :destroy

  belongs_to :reply_to,
    class_name: "Message",
    optional: true
  has_one :reply,
    class_name: "Message",
    foreign_key: :reply_to_id,
    dependent: :nullify

  delegate :hub, to: :conversation

  enum direction: {incoming: 0, outgoing: 1}
  enum status: {sent: 0, delivered: 1, failed: 2}
  enum state: {
    user_message: 0,
    bot_processing: 1,
    bot_message: 2,
    user_contribution_started: 3,
    bot_contribution_started: 4,
    user_contribution_cancelled: 5,
    bot_contribution_cancelled: 6,
    user_contribution_submitted: 7,
    bot_contribution_submitted: 8,
    closed_window: 9,
    unsupported_message: 10,
    knowledge_service_error: 11,
    rate_limit_reached: 12,
    bot_intermediary_message: 13,
    subscription_confirmed: 14,
    topic_notification: 15,
    unsubscription_confirmed: 16,
    topic_notification_sources: 17,
    interaction_see_sources: 18,
    bot_welcome_message: 19,
    non_question_reply: 20
  }

  # Outgoing states that should not start the inactivity timer: terminal/out-of-band notifications,
  # plus the contribution flow (not Q&A context worth closing a window over).
  IGNORED_STATES_FOR_TIMEOUT = %w[closed_window topic_notification topic_notification_sources subscription_confirmed unsubscription_confirmed bot_contribution_started bot_contribution_submitted bot_contribution_cancelled non_question_reply bot_welcome_message].freeze

  scope :in_deleted_conversations, -> { where(conversation: Conversation.deleted) }
  scope :in_live_conversations, -> { where(conversation: Conversation.not_deleted) }
  scope :readable_by, ->(user) { where(conversation: Conversation.readable_by(user)) }
  scope :external_with_bot_reply, -> {
    joins("INNER JOIN messages bot_reply ON bot_reply.reply_to_id = messages.id")
      .where.not(external_id: nil)
  }

  scope :external_with_answered_bot_reply, ->(answered) {
    external_with_bot_reply.where("bot_reply.answered = ?", answered)
  }

  # What "answered" and "unanswered" mean, in one place: every metric splitting questions those two
  # ways starts here. A null verdict is not a failed answer — that reply never attempted one (a
  # non-question, a welcome message, a timeout notice, a service error that cites nothing), so
  # counting it as unanswered reports a gap no document could close.
  scope :external_with_bot_answer_verdict, -> {
    external_with_bot_reply.where.not("bot_reply.answered": nil)
  }

  before_destroy :leave_cluster
  before_destroy :reassign_cluster_centroid
  before_validation :set_state, on: :create

  validates :body, :direction, presence: true

  validates_parent_not_deleted :conversation

  after_commit :process_incoming_message, on: :create
  after_commit :enqueue_message_sender, on: :create
  after_commit :update_conversation, on: [:create, :update]
  after_commit :update_external_user, on: :create
  after_commit :schedule_inactivity_check, on: :create
  after_create :persist_data_source_items, if: :outgoing?

  has_neighbors :embedding, dimensions: 1024

  def cluster_message_payload
    participant = conversation.participant
    {
      id: id,
      created_at: created_at,
      body: body,
      reply: reply ? {id: reply.id, body: reply.body, created_at: reply.created_at} : nil,
      conversation: {
        id: conversation.id,
        platform: conversation.platform,
        participant_id: conversation.participant_id,
        participant: {
          type: conversation.participant_type,
          name: participant.effective_display_name,
          trusted_user: participant.trusted_user
        }
      }
    }
  end

  def mark_as_failed!(code: nil, message: nil)
    error = {"code" => code&.to_s, "message" => message.to_s.truncate(500).presence}.compact
    self.metadata = metadata.to_h.merge("delivery_error" => error) if error.present?
    update!(status: :failed)
  end

  def as_json(options = {})
    extra = {}

    if direction == "outgoing"
      extra[:data_source_items] = data_source_items
      extra[:data_source_items_count] = data_source_items.size
    end

    extra[:topic_names] = topics.map(&:name)
    extra[:interactive_buttons] = interactive_buttons
    extra[:conversation] = conversation if options[:include_conversation]

    super.merge(extra).except("payload")
  end

  def history_for_knowledge_service(exclude_before_closed_window: false)
    # If this message is a reply to another message, use only that as context
    replied_to_id = metadata.to_h["replied_to_message_id"]
    if replied_to_id.present?
      replied_to_message = conversation.messages.find_by(id: replied_to_id)
      messages = replied_to_message ? [replied_to_message] : []

    # Otherwise, use the most recent messages in the conversation
    else
      base = exclude_before_closed_window ? messages_since_last_active_window : conversation.messages.where("id < ?", id)
      query = base.where.not(body: LOADING_STRING).where.not(state: [:rate_limit_reached, :bot_intermediary_message, :bot_processing, :non_question_reply])
      messages = query.order("id DESC").limit(4).to_a.reverse
    end

    messages.map do |message|
      role = {incoming: "user", outgoing: "assistant"}[message.direction.to_sym]
      entry = {role: role, content: message.body}
      # the knowledge service resumes the question before this refusal once the user answers with a location
      entry[:user_location_missing] = true if role == "assistant" && message.metadata.to_h["user_location_missing"] == true
      entry
    end
  end

  # Any hub member can open this link; the "me" view would only work for the conversation's participant
  def permalink
    from = conversation.internal? ? "team" : "audience"
    URI.join(ENV.fetch("FRONTEND_URL", "http://localhost:5173"), "hub/#{conversation.hub_id}/conversations/#{from}/#{conversation_id}?platforms=any&messageId=#{id}").to_s
  end

  def text_for_summarization
    body
  end

  def data_source_items
    message_data_source_items.filter_map do |mdsi|
      item = mdsi.item
      base = mdsi.data_source_payload

      item.present? ? base.merge(item.data_source_payload) : base
    end
  end

  # Topics to offer the user for subscription when this closed-window message is sent: the topics of
  # the conversation itself (this window's messages, see #window_messages), most frequent first.
  # We only include topics backed by at least one data source item (a document, contribution or
  # notebook, public or private), so we never offer a topic that has no content behind it yet.
  # Returns Topic records.
  def top_topics(limit = 3)
    return [] unless closed_window?

    message_topic_counts = TopicItem
      .where(item_type: "Message", item_id: window_messages.select(:id))
      .group(:topic_id)
      .count
    return [] if message_topic_counts.empty?

    supported_topic_ids = TopicItem
      .where(item_type: MessageDataSourceItem::ALLOWED_ITEM_TYPES, topic_id: message_topic_counts.keys)
      .distinct
      .pluck(:topic_id)

    topics_by_id = Topic.where(id: supported_topic_ids).index_by(&:id)
    message_topic_counts
      .select { |topic_id, _| topics_by_id.key?(topic_id) }
      .sort_by { |topic_id, count| [-count, topics_by_id[topic_id].name] }
      .first(limit)
      .map { |topic_id, _| topics_by_id[topic_id] }
  end

  def has_public_source_documents?
    message_data_source_items.any?(&:is_public_source_document?)
  end

  def interactive_buttons
    # The contribution prompt offers a single "Cancel" button
    if bot_contribution_started?
      return [{
        id: "cancel_contribution_#{id}",
        text: I18n.with_locale(conversation.language) { I18n.t(:contribution_cancel_word) },
        type: "cancel_contribution"
      }]
    end

    # A topic-notification offers "See More" (reuses the sources flow) and "Unsubscribe"
    if topic_notification?
      return [
        {id: "see_sources_#{id}", text: I18n.with_locale(conversation.language) { I18n.t(:topic_notification_see_more_button) }, type: "sources"},
        {id: "unsubscribe_#{notification_topic_ids.join("_")}", text: I18n.with_locale(conversation.language) { I18n.t(:topic_notification_unsubscribe_button) }, type: "unsubscribe"}
      ]
    end

    # A closed-window message offers a single "Subscribe" button when the window had topics
    if closed_window?
      return nil if top_topics.empty?
      return [{
        id: "subscribe_#{id}",
        text: I18n.with_locale(conversation.language) { I18n.t(:label_subscribe) },
        type: "subscribe"
      }]
    end

    # "See More": We display it if the message
    # was a question answered with publicly available sources
    return nil unless outgoing? &&
      metadata.to_h.dig("answerable") == true &&
      has_public_source_documents?

    # We can add other buttons in the future here
    [{
      id: "see_sources_#{id}",
      text: I18n.with_locale(conversation.language) { I18n.t(:label_see_sources) },
      type: "sources"
    }]
  end

  # WhatsApp rejects a template send when the resolved body (approved template text plus
  # substituted parameter values) exceeds this many characters.
  WHATSAPP_TEMPLATE_BODY_LIMIT = 1024

  # WhatsApp template arguments for messages that must be delivered as an approved template rather
  # than a regular message (e.g. topic notifications, which WhatsApp can't send outside the 24h
  # window). Returns nil for regular messages, so the sender treats it as an optional special case.
  def whatsapp_template
    return nil unless topic_notification?

    tone = hub.tone
    topics = Topic.where(id: notification_topic_ids).to_a.sort_by(&:name)
    return nil if topics.empty?
    topic_names = I18n.with_locale(conversation.language) { topics.map(&:name).to_sentence }
    items = message_data_source_items.to_a
    titles = items.map(&:item_title)
    content = Message.notification_content_summary(titles, items.first&.item&.external_url, conversation.language)
    # The approved template body is the same i18n string (see WhatsappTemplateCreationWorker), so we
    # can measure the exact resolved length. If an unusually long URL would push it past the limit
    # (failing the send), drop the URL - the capped title always fits, and the item stays one tap
    # away via "See More".
    if resolved_template_body(tone, topic_names, content).length > WHATSAPP_TEMPLATE_BODY_LIMIT
      content = Message.notification_content_summary(titles, nil, conversation.language)
    end
    parameters = [topic_names, content]
    {
      name: WhatsappMessagingIntegration.topic_notification_template_name(tone),
      language: WhatsappMessagingIntegration.template_language_code(conversation.language),
      parameters: parameters.map { |parameter| Message.whatsapp_sanitize_template_parameter(parameter) },
      button_payloads: interactive_buttons.map { |button| button[:id] }
    }
  end

  # The topic ids a topic notification covers. Messages created before digests could merge topics
  # carry a single "notification_topic_id" instead of the "notification_topic_ids" array.
  def notification_topic_ids
    metadata.to_h["notification_topic_ids"] || Array(metadata.to_h["notification_topic_id"])
  end

  # WhatsApp rejects template body parameters that contain newlines, tabs or 4+ consecutive spaces,
  # so collapse every whitespace run to a single space (e.g. a topic name or document title that
  # spans multiple lines would otherwise fail to send).
  def self.whatsapp_sanitize_template_parameter(value)
    value.to_s.gsub(/\s+/, " ").strip
  end

  # Cap on the title inside a notification summary, keeping room in the WhatsApp template body
  # (see WHATSAPP_TEMPLATE_BODY_LIMIT) for the URL. Independent from Document::CONTENT_SNIPPET_LENGTH
  # (the "See More" list summaries), which can change freely.
  NOTIFICATION_TITLE_MAX_LENGTH = 150

  # Renders a topic notification's content as '"<newest title>" (<url>) and X more.' when a digest
  # references several items, or just the title and URL when it references one. Shared by the worker
  # (which builds the message body from the items) and whatsapp_template (which reads the attached
  # data source items), so both produce the same string. Titles are expected newest-first. The title
  # is capped so the WhatsApp template body can't overflow on a pathological title.
  def self.notification_content_summary(titles, first_url, locale)
    first = '"' + titles.first.to_s.tr('"', "'").truncate(NOTIFICATION_TITLE_MAX_LENGTH, separator: " ", omission: "…") + '"'
    first += " (#{first_url})" if first_url.present?
    remaining = titles.length - 1
    return "#{first}." if remaining < 1

    I18n.with_locale(locale) { I18n.t(:topic_notification_content_summary, title: first, count: remaining) }
  end

  def embed?
    direction == "incoming" &&
      embedding.blank? &&
      body.present? &&
      user_message?
  end

  def get_and_store_embedding
    return unless embed?

    embedding = KnowledgeService.embed(body)
    update_columns(embedding: embedding)
  end

  def send_acknowledgement_message
    conversation.messages.create!(direction: "outgoing", body: intermediary_message_text("acknowledged"), state: :bot_processing)
  end

  # On platforms that support it, acknowledge with a free typing indicator instead of an
  # acknowledgement message (WhatsApp, for instance, charges for every outgoing message).
  # Internal conversations don't need any acknowledgement: the frontend displays a typing
  # animation while the last message is awaiting an answer.
  def acknowledge_receipt
    return if conversation.platform == "internal"

    if TypingIndicatorWorker.supports?(conversation)
      # `true` = this is the acknowledgement, so the worker falls back to an intermediary message if the
      # typing indicator can't be delivered (e.g. an RCS agent that isn't launched yet).
      TypingIndicatorWorker.perform_async(id, true)
    else
      send_acknowledgement_message
    end
  end

  private

  # The topic notification body exactly as WhatsApp resolves it: the approved template text (the
  # same i18n string, see WhatsappTemplateCreationWorker) with the parameter values substituted.
  def resolved_template_body(tone, topic_names, content)
    I18n.with_locale(conversation.language) { I18n.t(:"topic_notification_body_#{tone}", topic: topic_names, content: content) }
  end

  # Messages in this message's window: after the previous closed_window message, or - if there is
  # none - after the most recent gap of at least the inactivity timeout, or the whole conversation
  # if neither applies.
  def window_messages
    scope = id ? conversation.messages.where("id < ?", id) : conversation.messages
    boundary_id = closed_window_boundary_id(scope) || inactivity_boundary_id(scope)
    boundary_id ? scope.where("id > ?", boundary_id) : scope
  end

  def closed_window_boundary_id(scope)
    scope.where(state: :closed_window).order("id DESC").first&.id
  end

  MAX_WINDOW_MESSAGES = 100

  def inactivity_boundary_id(scope)
    pairs = scope.order(id: :desc).limit(MAX_WINDOW_MESSAGES + 1).pluck(:id, :created_at).reverse
    pairs.each_cons(2).reverse_each do |(earlier_id, earlier_at), (_, later_at)|
      return earlier_id if later_at - earlier_at >= Conversation.inactivity_timeout
    end
    pairs.first&.first if pairs.size > MAX_WINDOW_MESSAGES
  end

  # Like window_messages, but falls back to none (not the full conversation) when inactive.
  def messages_since_last_active_window
    scope = conversation.messages.where("id < ?", id)
    return scope.none unless scope.where(state: :closed_window).exists? || conversation.recently_active?(as_of: created_at, excluding: self)

    window_messages
  end

  def process_incoming_message
    if direction == "incoming"
      handler = ContributionHandler.new(self)
      contribution_handled = handler.process

      unless contribution_handled
        # Lock the conversation row to prevent race conditions when two messages
        # arrive simultaneously (e.g., duplicate greetings, rate limit miscounts)
        conversation.with_lock do
          limiter = ConversationRateLimiter.new(conversation)

          # Check if rate limit is reached
          if limiter.locked?
            # Create rate limit message without calling Knowledge Service
            conversation.messages.create!(
              direction: "outgoing",
              body: I18n.with_locale(conversation.language) { I18n.t(:message_conversation_locked) },
              state: :rate_limit_reached
            )
          else
            # Normal flow: acquire lock, acknowledge, hand off to the welcome worker or the Knowledge Service
            limiter.acquire!

            first_message = first_message_in_conversation?
            if first_message
              TypingIndicatorWorker.perform_async(id) if TypingIndicatorWorker.supports?(conversation)
            else
              acknowledge_receipt
            end

            snapshot = hub.personalization_for_knowledge_service
            update_columns(metadata: metadata.merge("personalization_snapshot" => snapshot))

            first_message ? WelcomeMessageWorker.perform_async(id) : KnowledgeServiceWorker.perform_async("chat", id)
            EmbedMessageWorker.perform_async(id)
            ChatTimeoutWorker.perform_in(6.minutes, id)
          end
        end
      end
    end
  end

  def persist_data_source_items
    metadata.to_h.with_indifferent_access["document_ids_cited"].to_a.each do |encoded_data_source_item|
      klass, id = Base64.decode64(encoded_data_source_item).split("/")
      next unless MessageDataSourceItem::ALLOWED_ITEM_TYPES.include?(klass)

      data_source_item = klass.constantize.find_by(id: id)
      next unless data_source_item && data_source_item.hub.id == hub.id

      message_data_source_items.find_or_create_by!(item: data_source_item)
    end
  end

  def enqueue_message_sender
    if direction == "outgoing" && conversation.platform != "internal"
      MessageSenderWorker.perform_async(id)
    end
  end

  def update_conversation
    return if conversation.deleted?
    conversation.update_column(:updated_at, Time.now)
  end

  def update_external_user
    if conversation.participant_type == "ExternalUser" && direction == "incoming"
      user = conversation.participant
      ExternalUser.where(id: user.id).update_all(
        [
          "messages_count = messages_count + 1, last_message_at = ?, first_message_at = COALESCE(first_message_at, ?)",
          created_at, created_at
        ]
      )
    end
  end

  def first_message_in_conversation?
    conversation.previously_new_record? || conversation.messages.incoming.count <= 1
  end

  def set_state
    return if state.present?
    if direction == "incoming"
      self.state = "user_message"
    elsif body == LOADING_STRING
      self.state = "bot_processing"
    elsif direction == "outgoing"
      self.state = "bot_message"
    end
  end

  def schedule_inactivity_check
    if outgoing? && IGNORED_STATES_FOR_TIMEOUT.exclude?(state)
      ConversationInactivityWorker.perform_in(Conversation.inactivity_timeout, id)
    end
  end

  def leave_cluster
    return unless message_cluster

    message_cluster.with_lock do
      if message_cluster.messages.where.not(id: id).exists?
        MessageCluster.update_counters(message_cluster_id, question_count: -1)
      else
        message_cluster.destroy!
      end
    end
  end

  def reassign_cluster_centroid
    cluster = cluster_as_centroid
    return unless cluster

    next_centroid = cluster.messages.where.not(id: id).order(:id).first

    if next_centroid
      cluster.update!(centroid_message_id: next_centroid.id, centroid_embedding: next_centroid.embedding, original_text: next_centroid.body)
    else
      cluster.destroy!
    end
  end
end
