module KnowledgeServiceSyncable
  extend ActiveSupport::Concern

  PRIORITY_TIER_LOW = -1
  PRIORITY_TIER_DEFAULT = 1
  PRIORITY_TIER_HIGH = 2

  SYNCABLE_CLASSES = %w[Document Notebook Contribution].freeze

  TOPICS_SYNC_DELAY = 5.seconds

  # Keep in sync with ValidationCode in apps/knowledge/app/core/ingestion_validation.py —
  # codes here are the ones ingestion treats as deterministic (non-retryable) failures.
  NON_RETRYABLE_ERROR_CODES = %w[NO_TEXT_FOUND TEXT_TOO_LARGE PDF_PASSWORD_PROTECTED].freeze

  included do
    enum sync_status: {pending: 0, error: 1, complete: 2}

    scope :non_retryable, -> { where(sync_status: :error, last_sync_error_code: NON_RETRYABLE_ERROR_CODES) }
    scope :excluding_non_retryable, -> { where.not(id: non_retryable) }

    validates :priority_tier, inclusion: {in: [PRIORITY_TIER_LOW, PRIORITY_TIER_DEFAULT, PRIORITY_TIER_HIGH]}

    after_commit :set_initial_sync_status, on: :create
    after_commit :handle_knowledge_service_sync, if: :knowledge_service_sync_required?, on: :update
  end

  def retryable?
    error? && !NON_RETRYABLE_ERROR_CODES.include?(last_sync_error_code)
  end

  def as_json(options = {})
    super.merge(retryable: retryable?)
  end

  def self.topics_sync_key(item_ref)
    "knowledge_service/sync_topics/#{item_ref}"
  end

  def sync_topics_to_knowledge_service
    return unless topics_syncable?

    item_ref = "#{self.class.name}/#{id}"
    # One job per burst of changes; it reads the topics when it runs
    return unless Rails.cache.write(KnowledgeServiceSyncable.topics_sync_key(item_ref), true, unless_exist: true, expires_in: TOPICS_SYNC_DELAY + 1.minute)

    KnowledgeServiceWorker.perform_in(TOPICS_SYNC_DELAY, "sync_topics", item_ref)
  end

  def topics_syncable?
    active? && complete?
  end

  private

  def knowledge_service_sync_required?
    saved_change_to_active? || (saved_change_to_priority_tier? && active?)
  end

  def set_initial_sync_status
    active? ? mark_pending! : update_column(:sync_status, :complete) # If it's created as not active, there is nothing to sync
  end

  def handle_knowledge_service_sync
    mark_pending!
    active? ? send_to_knowledge_service : remove_from_knowledge_service
  end

  def mark_pending!
    update_column(:sync_status, :pending)
    StaleSyncWorker.perform_in(24.hours, self.class.name, id)
  end
end
