class ExternalUser < ApplicationRecord
  include Anonymizable

  anonymizable :external_id, :display_name, :metadata

  belongs_to :hub
  has_many :conversations, as: :participant
  has_many :topic_subscriptions, dependent: :destroy
  has_many :subscribed_topics, through: :topic_subscriptions, source: :topic

  enum platform: AppInfo::PLATFORMS

  validates :external_id, presence: true
  validates :platform, presence: true, inclusion: {in: %w[telegram whatsapp sms signal]}
  validates :external_id, uniqueness: {scope: [:hub_id, :platform]}

  scope :active, -> { where("last_message_at >= ?", 30.days.ago) }
  scope :with_last_conversation_id, -> {
    select(<<~SQL.squish)
      external_users.*,
      (SELECT conversations.id FROM conversations
       WHERE conversations.participant_id = external_users.id
         AND conversations.participant_type = 'ExternalUser'
         AND conversations.deleted_at IS NULL
       ORDER BY conversations.updated_at DESC
       LIMIT 1) AS last_conversation_id
    SQL
  }

  class UnresolvableIdentifier < StandardError; end

  # Some platforms identify end-users by an id admins can't know (Signal's account UUID), so the identifier
  # they were given is resolved to it first. Raises UnresolvableIdentifier with a message for the admin.
  def self.resolve_external_id(hub, platform, identifier)
    return identifier unless platform.to_s == "signal"
    SignalMessagingIntegration.end_user_id_for(hub, identifier)
  end

  # Prefer the exact identifier; a variant set holds at most one other spelling and the unique index
  # allows at most one row per spelling, so anything left over is a single record.
  def self.find_or_initialize_by_identity(hub, platform, external_id)
    candidates = hub.external_users.where(
      platform: platform,
      external_id: PhoneIdentity.variants(external_id, platform)
    ).order(:id).to_a
    candidates.find { |candidate| candidate.external_id == external_id.to_s } ||
      candidates.first ||
      hub.external_users.new(platform: platform, external_id: external_id)
  end

  def as_json(_options = {})
    super.slice("id", "hub_id", "platform", "trusted_user", "first_message_at", "last_message_at", "messages_count")
      .merge({
        name: effective_display_name,
        external_id: trusted_user ? external_id : nil,
        last_conversation_id: read_attribute(:last_conversation_id)
      })
  end

  def effective_display_name
    (trusted_user && display_name.present?) ? display_name : "user-#{id}"
  end

  def opted_out?
    opted_out_at.present?
  end

  def opt_out!
    update!(opted_out_at: Time.now) unless opted_out?
  end

  def opt_in!
    update!(opted_out_at: nil) if opted_out?
  end
end
