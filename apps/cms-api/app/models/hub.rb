class Hub < ApplicationRecord
  include PlanRestrictions
  include ScenarioMessageCacheable

  has_many :hub_memberships, dependent: :destroy
  has_many :users, through: :hub_memberships
  has_many :sources, dependent: :destroy
  has_many :notebooks, dependent: :destroy
  has_many :conversations, dependent: :destroy
  has_many :bulk_conversation_exports, dependent: :destroy
  has_many :contributions, dependent: :destroy
  has_many :messaging_integrations, dependent: :destroy
  has_many :external_users, dependent: :destroy
  has_many :external_resources, dependent: :destroy
  has_many :topics, dependent: :destroy
  belongs_to :organization

  enum :plan, {free: 0, enterprise: 1, free_unrestricted: 2, standard: 3, pro: 4, subsidized: 5}, validate: true
  attribute :contribution_workflow_mode, :string, default: "direct"
  enum :contribution_workflow_mode, {direct: "direct", review: "review"}, validate: true
  attribute :contribution_audience, :string, default: "trusted_end_users"
  enum :contribution_audience, {trusted_end_users: "trusted_end_users", all_end_users: "all_end_users"}, prefix: :contributions_from, validate: true

  CUSTOM_LIMIT_KEYS = %w[sources messages documents sms].freeze
  # Custom-limit keys whose value is a boolean feature toggle rather than a numeric cap.
  BOOLEAN_CUSTOM_LIMIT_KEYS = %w[sms].freeze

  # Personalization tones for bot messages (see bot_attributes "tone")
  TONES = %w[journalist advocate executive].freeze

  # Hashtag-like code end-users send to start a contribution
  CONTRIBUTION_CODE_FORMAT = /\A#[[:alnum:]]{6,36}\z/

  store_accessor :bot_attributes, :default_language, :supported_languages

  # Set on creation to opt a hub out of the preloaded data source (the demo hubs in the seeds already
  # come with their own content)
  attr_accessor :skip_data_preload

  # Names of all topics known to this hub, sorted alphabetically
  def topic_names
    topics.order(:name).pluck(:name)
  end

  def tone
    bot_attributes&.dig("tone").presence || "journalist"
  end

  # Override Rails enum predicate to treat both free plans as "free"
  def free?
    plan.in?(["free", "free_unrestricted"])
  end

  # Check if this is the restricted free plan (vs free_unrestricted)
  def restricted?
    plan == "free"
  end

  def premium?
    plan.in?(["enterprise", "standard", "pro", "subsidized"])
  end

  before_validation :set_invite_code, on: :create
  before_validation :set_contribution_code, on: :create
  before_validation :normalize_contribution_code
  before_validation :set_trial_dates, on: :create
  before_validation :adjust_trial_dates_on_plan_change, on: :update
  before_update :disable_trial_emails_on_date_change
  after_commit :send_trial_welcome_email, on: :create
  after_commit :preload_data, on: :create

  validates :invite_code, presence: true, uniqueness: true
  validates :name, presence: true
  validates :name, length: {maximum: 100}
  validate :contribution_code_format
  validate :trial_dates_consistency
  validate :premium_plans_no_trial
  validate :free_plans_require_trial
  validate :custom_limits_schema
  validate :bot_languages_supported

  has_one_attached :profile_picture

  def as_json(options = {})
    data = {id: id, name: name, profile_picture_url: profile_picture_url, allowed_features: allowed_features, bot_attributes: bot_attributes, plan: plan, contribution_workflow_mode: contribution_workflow_mode, contribution_audience: contribution_audience, trial_active: trial_active?, trial_expired: trial_expired?, restricted: restricted?,
            external_data_sources_count: sources.not_deleted.count, documents_count: total_documents, active_external_users_count: active_external_users_count,
            max_sources_for_plan: max_sources_for_plan, max_documents_for_plan: max_documents_for_plan, max_messages_for_plan: max_messages_for_plan,
            user_agent: self.class.user_agent_for(id)}
    # Counts a month of messages, so it is served only where it is read — one hub's billing usage —
    # and not once per hub when a user's whole hub list is serialized.
    if options[:include_monthly_messages_count]
      data[:monthly_messages_count] = monthly_messages_count
    end
    if free?
      data[:trial_started_at] = trial_started_at
      data[:trial_ends_at] = trial_ends_at
      data[:trial_emails_enabled] = trial_emails_enabled
    end
    if options[:include_codes]
      data[:invite_code] = invite_code
      data[:contribution_code] = contribution_code
    end
    if options[:include_hub_membership_for_user_id]
      user = User.find(options[:include_hub_membership_for_user_id])
      membership = HubMembership.find_by(hub_id: id, user_id: user.id)
      if membership
        data[:hub_membership] = membership.as_json(include_onboarding_tasks: true, include_capabilities: true)
      elsif user.is_admin
        data[:hub_membership] = virtual_membership_for_super_admin(user)
      end
    end
    data[:pending_approvals] = HubMembership.where(hub_id: id, approved: false).count if options[:include_pending_approvals_count]
    data[:onboarding_tasks] = onboarding_tasks if options[:include_onboarding_tasks]
    data
  end

  def as_joinable
    {
      id: id,
      name: name,
      created_at: created_at,
      users_count: users.count,
      admin_email: hub_memberships.where(role: :admin).first.user.email.gsub(/^(.)[^@]+(.)@/, '\1*****\2@')
    }
  end

  def profile_picture_url
    profile_picture.attached? ? Rails.application.routes.url_helpers.rails_storage_proxy_url(profile_picture, host: ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000")) : nil
  end

  def refresh_invite_code!
    self.invite_code = Hub.generate_invite_code
    save!
  end

  def personalization_for_knowledge_service
    personalization = {}
    personalization[:hub_name] = name
    personalization[:tone] = tone
    if bot_attributes.present?
      personalization[:name] = bot_attributes["name"] if bot_attributes["name"].present?
      personalization[:description] = bot_attributes["description"] if bot_attributes["description"].present?
      personalization[:default_language] = default_language if default_language.present?
      personalization[:supported_languages] = supported_languages if supported_languages.present?
    end

    # Add external resources if present
    external_resources = self.external_resources.map do |resource|
      {
        title: resource.title,
        resource_type: resource.resource_type,
        description: resource.description,
        scenarios: resource.scenarios
      }
    end
    personalization[:external_resources] = external_resources if external_resources.any?
    personalization
  end

  def generate_and_cache_first_message(language, force: false)
    Rails.cache.fetch(ScenarioMessageCacheable.cache_key(id, "first_message", language), force: force, skip_nil: true) do
      KnowledgeService.preview("first_message", personalization_for_knowledge_service.merge(default_language: language)).presence
    end
  end

  def first_message_for_conversation(language, force: false)
    language = SUPPORTED_LANGUAGES.key?(language.to_s) ? language.to_s : "en"
    llm_message = generate_and_cache_first_message(language, force: force)
    disclaimer = I18n.t(:first_message_ai_disclaimer, locale: language)
    [llm_message, disclaimer].compact.join("\n\n")
  end

  # No supported languages configured means any language is accepted
  def single_language?
    supported_languages.to_a.size == 1
  end

  def supports_language?(language)
    supported_languages.blank? || supported_languages.include?(language)
  end

  def closed_message_for_conversation(language, topic_names, force: false)
    language = SUPPORTED_LANGUAGES.key?(language.to_s) ? language.to_s : "en"
    message = begin
      # Kept until personalization changes; a stale message is replaced by regenerating the preview
      Rails.cache.fetch(ScenarioMessageCacheable.cache_key(id, "conversation_closed", language), force: force, skip_nil: true) do
        KnowledgeService.preview("conversation_closed", personalization_for_knowledge_service.merge(default_language: language)).presence
      end
    # Any failure must still produce a closing message, and KnowledgeService errors share no common class
    rescue => e
      LogService.log(:error, "Hub", "Failed to generate closing message for hub #{id}: #{e.class}: #{e.message}")
      nil
    end
    message ||= I18n.t(:conversation_inactivity_closing, locale: language)
    return message if topic_names.empty?

    topics_sentence = I18n.t(:message_closed_window_topics, topics: topic_names.to_sentence(locale: language), locale: language)
    "#{message}\n\n#{topics_sentence}"
  end

  def trial_active?
    free? && trial_started_at.present? && trial_ends_at.present? && Time.current < trial_ends_at
  end

  def trial_expired?
    free? && trial_ends_at.present? && Time.current >= trial_ends_at
  end

  # The "own_" tasks ignore preloaded sources and their documents: the onboarding calls to action read
  # those, so they keep asking for the hub's own content. The others count preloaded content like any
  # other, and gate what the app unlocks.
  def onboarding_tasks
    {
      source_created: source_ever_created?,
      messaging_platform_connected: messaging_platform_ever_connected?,
      document_synced: document_ever_synced?,
      internal_conversation_message_received: internal_conversation_message_ever_received?,
      own_source_created: own_source_ever_created?,
      own_document_synced: own_document_ever_synced?
    }
  end

  def should_prioritize_recent_documents?
    total_documents > 100 # This logic will probably evolve over time
  end

  # the knowledge service refuses a location-dependent question until the conversation holds the user's location
  # sent with every chat like the recency flag, so the gate follows the hub, not the service
  def location_gate_enabled?
    allowed_features.to_h["LOCATION_GATE"] == true
  end

  def admins
    hub_memberships.where(role: :admin, approved: true).includes(:user).map(&:user)
  end

  def self.user_agent_for(hub_id)
    "Suwali/1.0 (Hub #{hub_id}; +https://suwali.io)"
  end

  def self.generate_invite_code
    max_retries = 10
    retries = 0

    loop do
      # Generate 6-character Base-36 code (0-9, A-Z)
      # Range: 0 to 36^6 - 1 (2,176,782,335)
      code = SecureRandom.random_number(36**6).to_s(36).upcase.rjust(6, "0")

      # Try to reserve the code (DB constraint ensures uniqueness)
      begin
        HubReservedInviteCode.create!(code: code)
        break code
      rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
        # Handle both DB constraint violation and validation error
        retries += 1
        raise "Failed to generate unique invite code after #{max_retries} attempts" if retries >= max_retries
        # Loop and try again
      end
    end
  end

  def self.generate_contribution_code
    loop do
      code = "#contrib#{rand(1000..9999)}"
      break code unless Hub.exists?(contribution_code: code)
    end
  end

  def self.trial_length
    ENV.fetch("HUB_TRIAL_LENGTH_DAYS", "30").to_i.days
  end

  def self.trial_deletion_grace_period
    ENV.fetch("HUB_TRIAL_DELETION_GRACE_PERIOD_DAYS", "30").to_i.days
  end

  def self.eligible_for_deletion
    grace_period_cutoff = Time.current - trial_deletion_grace_period
    where(plan: [Hub.plans[:free], Hub.plans[:free_unrestricted]])
      .where("(trial_ends_at IS NOT NULL AND trial_ends_at < ?) OR deletion_requested_at IS NOT NULL", grace_period_cutoff)
  end

  # Acquires a deletion lock for the given hub and executes the block
  # Returns :locked if lock cannot be acquired (deletion already in progress)
  # Returns :not_found if hub doesn't exist
  # Returns :success if block executed successfully
  def self.with_deletion_lock(hub_id)
    hub = Hub.find_by(id: hub_id)
    return :not_found if hub.nil?
    return :locked if hub.deletion_in_progress?

    # Acquire lock
    hub.update!(deletion_in_progress: true, deletion_started_at: Time.current)

    begin
      yield hub
      :success
    ensure
      # Always release lock after block execution (or error)
      # Hub might be deleted by the block, so we need to check first
      Hub.where(id: hub_id).update_all(deletion_in_progress: false, deletion_started_at: nil)
    end
  end

  def send_trial_emails(step)
    return unless free? && trial_emails_enabled?

    I18n.with_locale(default_language || I18n.default_locale) do
      admins.each do |admin|
        HubMailer.public_send(step, admin).deliver_later
      end
    end

    update_column(:trial_emails_sent, trial_emails_sent + [step.to_s])
  end

  private

  def virtual_membership_for_super_admin(user)
    role = user.is_write_admin ? :admin : :editor
    membership = HubMembership.new(user: user, hub: self, role: role, approved: true)
    membership.readonly! # Safeguard to make sure it won't be persisted
    membership.as_json(include_onboarding_tasks: true, include_capabilities: true)
  end

  def source_ever_created?
    return true if sources.exists?
    cache_key = "hub/#{id}/source_ever_created"
    return true if Rails.cache.read(cache_key)

    result = compute_source_ever_created
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_source_ever_created
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT EXISTS (
          SELECT 1 FROM audit.sources_log
          WHERE operation = 'INSERT'
          AND new_data->>'hub_id' = ?
        ) AS exists",
        id.to_s
      ])
    )
    result.first["exists"]
  end

  def own_source_ever_created?
    return true if sources.where(preloaded: false).exists?
    cache_key = "hub/#{id}/own_source_ever_created"
    return true if Rails.cache.read(cache_key)

    result = compute_own_source_ever_created
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_own_source_ever_created
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        # Audit rows written before the preloaded column existed have no such key, and every one of
        # them predates the feature, so a missing key means "not preloaded".
        "SELECT EXISTS (
          SELECT 1 FROM audit.sources_log
          WHERE operation = 'INSERT'
          AND new_data->>'hub_id' = ?
          AND COALESCE(new_data->>'preloaded', 'false') = 'false'
        ) AS exists",
        id.to_s
      ])
    )
    result.first["exists"]
  end

  def messaging_platform_ever_connected?
    return true if messaging_integrations.exists?

    cache_key = "hub/#{id}/messaging_platform_ever_connected"
    return true if Rails.cache.read(cache_key)

    result = compute_messaging_platform_ever_connected
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_messaging_platform_ever_connected
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT EXISTS (
          SELECT 1 FROM audit.messaging_integrations_log
          WHERE operation = 'INSERT'
          AND new_data->>'hub_id' = ?
        ) AS exists",
        id.to_s
      ])
    )
    result.first["exists"]
  end

  def document_ever_synced?
    cache_key = "hub/#{id}/document_ever_synced"
    return true if Rails.cache.read(cache_key)

    result = compute_document_ever_synced
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_document_ever_synced
    return true if Document.joins(:source).where(sources: {hub_id: id}, sync_status: :complete).exists?
    # Documents start as pending on INSERT and transition to complete via a later UPDATE,
    # so we look for an UPDATE that set sync_status to complete.
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT EXISTS (
          SELECT 1 FROM audit.documents_log
          WHERE operation = 'UPDATE'
          AND new_data->>'sync_status' = ?
          AND new_data->>'source_id' IN (
            SELECT id::text FROM sources WHERE hub_id = ?
          )
        ) AS exists",
        Document.sync_statuses[:complete].to_s, id
      ])
    )
    result.first["exists"]
  end

  def own_document_ever_synced?
    cache_key = "hub/#{id}/own_document_ever_synced"
    return true if Rails.cache.read(cache_key)

    result = compute_own_document_ever_synced
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_own_document_ever_synced
    return true if Document.joins(:source).where(sources: {hub_id: id, preloaded: false}, sync_status: :complete).exists?
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT EXISTS (
          SELECT 1 FROM audit.documents_log
          WHERE operation = 'UPDATE'
          AND new_data->>'sync_status' = ?
          AND new_data->>'source_id' IN (
            SELECT id::text FROM sources WHERE hub_id = ? AND preloaded = false
          )
        ) AS exists",
        Document.sync_statuses[:complete].to_s, id
      ])
    )
    result.first["exists"]
  end

  def internal_conversation_message_ever_received?
    return true if conversations.where(platform: :internal).joins(:messages).merge(Message.incoming).exists?
    cache_key = "hub/#{id}/internal_conversation_message_ever_received"
    return true if Rails.cache.read(cache_key)

    result = compute_internal_conversation_message_ever_received
    Rails.cache.write(cache_key, true, expires_in: nil) if result
    result
  end

  def compute_internal_conversation_message_ever_received
    result = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT EXISTS (
          SELECT 1 FROM audit.messages_log
          WHERE operation = 'INSERT'
          AND new_data->>'direction' = ?
          AND new_data->>'conversation_id' IN (
            SELECT id::text FROM conversations WHERE hub_id = ? AND platform = ?
          )
        ) AS exists",
        Message.directions[:incoming].to_s, id, Conversation.platforms[:internal]
      ])
    )
    result.first["exists"]
  end

  def disable_trial_emails_on_date_change
    if trial_started_at_changed? || trial_ends_at_changed?
      self.trial_emails_enabled = false
    end
  end

  def send_trial_welcome_email
    send_trial_emails(:trial_welcome)
  end

  def preload_data
    return if skip_data_preload || HubPreloadWorker.url.blank?

    # The source is created here and not in the worker so that it is already listed when the user opens
    # Data Sources; downloading the document and attaching it is what stays in the background
    HubPreloadWorker.create_source!(self)
    # I18n.locale is request-scoped, so it is captured here and replayed inside the worker
    HubPreloadWorker.perform_async(id, I18n.locale.to_s)
  end

  def set_invite_code
    self.invite_code ||= Hub.generate_invite_code
  end

  def set_contribution_code
    self.contribution_code ||= Hub.generate_contribution_code
  end

  def normalize_contribution_code
    return if contribution_code.nil?
    code = contribution_code.strip.sub(/\A#+/, "")
    self.contribution_code = code.present? ? "##{code}" : code
  end

  def contribution_code_format
    if contribution_code.blank?
      errors.add(:base, I18n.t(:error_hub_contribution_code_blank))
    elsif !contribution_code.match?(CONTRIBUTION_CODE_FORMAT)
      errors.add(:base, I18n.t(:error_hub_invalid_contribution_code))
    end
  end

  def set_trial_dates
    if free? && trial_started_at.nil?
      self.trial_started_at = Time.current
      self.trial_ends_at = trial_started_at + Hub.trial_length
    end
  end

  def adjust_trial_dates_on_plan_change
    return unless plan_changed?

    if premium?
      self.trial_started_at = nil
      self.trial_ends_at = nil
    elsif free? && trial_started_at.nil? && trial_ends_at.nil?
      self.trial_started_at = Time.current
      self.trial_ends_at = trial_started_at + Hub.trial_length
    end
  end

  def trial_dates_consistency
    # Both trial dates must be present or both must be nil
    if trial_started_at.present? && trial_ends_at.blank?
      errors.add(:base, I18n.t(:error_hub_trial_ends_at_missing))
    elsif trial_started_at.blank? && trial_ends_at.present?
      errors.add(:base, I18n.t(:error_hub_trial_started_at_missing))
    end

    # trial_ends_at must be after trial_started_at
    if trial_started_at.present? && trial_ends_at.present? && trial_ends_at <= trial_started_at
      errors.add(:base, I18n.t(:error_hub_trial_ends_at_before_start))
    end
  end

  def premium_plans_no_trial
    if premium? && (trial_started_at.present? || trial_ends_at.present?)
      errors.add(:base, I18n.t(:error_hub_premium_plans_no_trial))
    end
  end

  def free_plans_require_trial
    if free? && (trial_started_at.blank? || trial_ends_at.blank?)
      errors.add(:base, I18n.t(:error_hub_free_plans_require_trial))
    end
  end

  def custom_limits_schema
    return if custom_limits.nil?
    custom_limits.keys.map(&:to_s).each do |key|
      unless CUSTOM_LIMIT_KEYS.include?(key)
        errors.add(:base, I18n.t(:error_hub_unknown_custom_limit_key, key: key))
      end
    end
    custom_limits.each do |key, val|
      valid = if BOOLEAN_CUSTOM_LIMIT_KEYS.include?(key.to_s)
        [true, false].include?(val)
      else
        val.is_a?(Integer) && val >= 0
      end
      errors.add(:base, I18n.t(:error_hub_invalid_custom_limit, key: key)) unless valid
    end
  end

  def bot_languages_supported
    languages = supported_languages.to_a
    ((languages + [default_language]).compact_blank.uniq - SUPPORTED_LANGUAGES.keys).each do |language|
      errors.add(:base, I18n.t(:error_hub_unsupported_language, language: language))
    end
    if default_language.present? && !supports_language?(default_language)
      errors.add(:base, I18n.t(:error_hub_default_language_not_in_supported_languages))
    end
  end
end
