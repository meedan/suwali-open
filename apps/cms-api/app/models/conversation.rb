class Conversation < ApplicationRecord
  include Anonymizable
  include HubAccessible
  include SoftDeletable
  include NotebookItemable
  include HasUniqueTitle
  include TrialRestrictable
  include LabelOrderable

  anonymizable :title, :context

  MAX_CONTEXT_NOTES = 1
  MAX_CONTEXT_NOTE_LENGTH = 200

  belongs_to :hub
  belongs_to :participant, polymorphic: true

  # A conversation's participant is an ExternalUser or a User. Anonymous people are shown as "user-<id>",
  # so the id is padded to keep them in numeric order.
  PARTICIPANT_LABEL_SQL = <<~SQL.squish
    COALESCE(
      (SELECT CASE WHEN eu.trusted_user AND eu.display_name <> ''
          THEN LOWER(eu.display_name)
          ELSE 'user-' || LPAD(eu.id::text, 12, '0') END
        FROM external_users eu
        WHERE conversations.participant_type = 'ExternalUser' AND eu.id = conversations.participant_id),
      (SELECT LOWER(COALESCE(NULLIF(u.name, ''), u.email))
        FROM users u
        WHERE conversations.participant_type = 'User' AND u.id = conversations.participant_id)
    )
  SQL

  scope :ordered_by_participant_name, ->(direction) { order_by_label(PARTICIPANT_LABEL_SQL, direction) }
  scope :from_end_users, ->(trusted:) {
    joins("INNER JOIN external_users ON external_users.id = conversations.participant_id AND conversations.participant_type = 'ExternalUser'")
      .where(external_users: {trusted_user: trusted})
  }
  scope :by_hub_members, -> {
    where("participant_type != 'User' OR EXISTS (SELECT 1 FROM hub_memberships WHERE hub_memberships.hub_id = conversations.hub_id AND hub_memberships.user_id = conversations.participant_id AND hub_memberships.approved = true)")
  }
  # What hub lists show: hides conversations of non-members (e.g. super admins); doesn't check the viewer's hubs
  scope :listed_for, ->(user) { user.is_admin ? all : by_hub_members }
  # For lookups by ID, where the hub isn't already fixed
  scope :readable_by, ->(user) { accessible_by(user).listed_for(user) }
  scope :current_for, ->(participant, platform) { not_deleted.where(participant:, platform:) }

  has_many :messages, dependent: :destroy

  async_destroy_with DestroyConversationWithMessagesWorker

  delegate :trusted_user, to: :participant

  enum platform: AppInfo::PLATFORMS
  enum state: {normal: 0, awaiting_contribution: 1}

  before_validation :set_default_language, on: :create
  after_destroy :destroy_orphaned_external_participant

  validates :title, :platform, :participant_id, :participant_type, presence: true
  validate :validate_participant_type_for_platform

  def as_json(options = {})
    super.merge({participant: participant.as_json(options).merge({type: participant_type})})
  end

  def title_exists?
    Conversation.exists?(title: title, hub: hub, participant: participant)
  end

  def reset_to_normal!
    update!(state: :normal)
  end

  # True while the user is mid-conversation, i.e. they sent a message within the inactivity timeout.
  # Topic notifications skip active conversations - they exist to re-engage idle users, and mid-chat
  # the user is already engaged. Keyed on incoming messages so our own outgoing notification doesn't
  # make the conversation look active to the next run.
  def recently_active?(as_of: Time.now, excluding: nil)
    scope = messages.where(direction: :incoming).where(created_at: (as_of - Conversation.inactivity_timeout)...as_of)
    scope = scope.where.not(id: excluding.id) if excluding
    scope.exists?
  end

  def substantive_reply_since?(time)
    messages.where(direction: :outgoing).where("created_at > ?", time).where.not(state: Message::IGNORED_STATES_FOR_TIMEOUT).exists?
  end

  def set_awaiting_contribution!
    update!(state: :awaiting_contribution)
  end

  def text_for_summarization
    return "" if messages.count == 0
    messages.last.history_for_knowledge_service.to_json
  end

  def summarizable?
    ai_summary.present? || messages_count.to_i > 0
  end

  def deletable_by?(user)
    internal? ? participant == user : user.is_write_admin
  end

  def update_language(new_language)
    return unless new_language.present? && new_language != language
    return if hub && !hub.supports_language?(new_language)
    update_column(:language, new_language)
  end

  def context_for_knowledge_service
    context.map { |note| note.slice("id", "text") }
  end

  # Overlapping messages can each add a note and their callbacks can arrive out of order, so the cap
  # keeps the notes from the newest messages
  def apply_context_updates!(updates, message)
    updates = Array(updates).select { |update| update.is_a?(Hash) }
    return if updates.empty?

    with_lock do
      removed_ids = updates.filter_map { |update| update["id"].to_s if update["op"] == "remove" }
      notes = context.reject { |note| removed_ids.include?(note["id"]) }
      updates.each do |update|
        text = update["text"].to_s.strip
        next unless update["op"] == "add" && text.present? && text.length <= MAX_CONTEXT_NOTE_LENGTH
        next if notes.any? { |note| note["text"].casecmp?(text) }
        notes << {"id" => SecureRandom.uuid, "text" => text, "message_id" => message.id, "created_at" => Time.current.iso8601}
      end
      notes = notes.sort_by.with_index { |note, index| [note["message_id"].to_i, index] }.last(MAX_CONTEXT_NOTES)
      changes = context_changes(context, notes)
      update!(context: notes)
      # recorded on the message so the conversation flow can show what each message changed
      message.update_columns(metadata: message.metadata.to_h.merge("context_updates" => changes)) if changes.any?
    end
  end

  # Silence after which a conversation's window is considered closed (see ConversationInactivityWorker)
  def self.inactivity_timeout
    ENV.fetch("CONVERSATION_INACTIVITY_TIMEOUT_MINUTES", "10").to_i.minutes
  end

  private

  def context_changes(before, after)
    before_ids = before.map { |note| note["id"] }
    after_ids = after.map { |note| note["id"] }
    removed = before.reject { |note| after_ids.include?(note["id"]) }.map { |note| {"op" => "remove", "text" => note["text"]} }
    added = after.reject { |note| before_ids.include?(note["id"]) }.map { |note| {"op" => "add", "text" => note["text"]} }
    removed + added
  end

  def set_default_language
    return if language_changed? # don't override if explicitly set
    self.language = hub&.default_language || "en"
  end

  def validate_participant_type_for_platform
    if platform == "internal" && participant_type != "User"
      errors.add(:base, I18n.t(:error_participant_type_for_internal_conversation))
    end
  end

  def destroy_orphaned_external_participant
    participant.destroy! if participant.is_a?(ExternalUser) && participant.conversations.none?
  end
end
