class Source < ApplicationRecord
  include HubAccessible
  include SoftDeletable
  include TrialRestrictable
  include HasUniqueTitle

  alias_attribute :title, :name

  attr_accessor :ownership_receipt

  belongs_to :hub
  has_many :documents, dependent: :destroy
  has_many :deleted_documents, dependent: :destroy
  has_many :non_retryable_documents, -> { non_retryable }, class_name: "Document"

  NON_RETRYABLE_DOCUMENTS_LIMIT = 100

  TYPES = {
    website: 0,
    google_drive_folder: 1,
    conversation: 2, # Deprecated
    rss_feed: 3,
    json_api: 4,
    uploaded_files: 5,
    wordpress_api: 6
  }

  API_EXPOSED_CONFIG_KEYS = {
    website: [
      "base_url",
      "pagination_start",
      "pagination_end",
      "post_link_selector",
      "title_selector",
      "body_selector"
    ],
    google_drive_folder: [
      "folder_url"
    ],
    rss_feed: [
      "feed_url",
      "expanded_description_selector"
    ],
    json_api: [
      "base_url"
    ],
    uploaded_files: [],
    wordpress_api: [
      "content_type",
      "site_url"
    ]
  }.freeze

  enum source_type: TYPES

  async_destroy_with DestroySourceWithDocumentsWorker

  validates :name, :source_type, presence: true
  validate :check_plan_restrictions, on: :create
  before_validation SourceIngestors::WordpressOwnership, if: :wordpress_api?
  validate SourceIngestors::WordpressOwnership, if: :wordpress_api?
  after_save SourceIngestors::WordpressOwnership, if: :wordpress_api?

  after_commit :schedule_ingestion, on: :create

  def as_json(options = {})
    super
      .except("config")
      .merge(
        config: api_exposed_config,
        external_url: external_url,
        documents_count: documents_count,
        ingestion_errors: last_ingestion_errors,
        non_retryable_documents: non_retryable_documents_payload
      )
  end

  def api_exposed_config
    allowed_keys = API_EXPOSED_CONFIG_KEYS
      .fetch(source_type.to_sym, [])
      .map(&:to_s)

    config.to_h.slice(*allowed_keys)
  end

  def external_url
    case source_type
    when "website"
      config.to_h["base_url"].to_s.gsub("{page}", "1")
    when "google_drive_folder"
      config.to_h["folder_url"].to_s
    when "rss_feed"
      config.to_h["feed_url"].to_s
    when "json_api"
      config.to_h["base_url"].to_s
    when "uploaded_files"
      nil
    when "wordpress_api"
      config.to_h["site_url"].to_s
    end
  end

  def handler
    base_config = config.to_h.with_indifferent_access.merge(user_agent: Hub.user_agent_for(hub_id))
    case source_type
    when "website"
      SourceIngestors::Website.new(base_config)
    when "google_drive_folder"
      SourceIngestors::GoogleDriveFolder.new(base_config)
    when "rss_feed"
      SourceIngestors::RssFeed.new(base_config)
    when "json_api"
      SourceIngestors::JsonApi.new(base_config)
    when "wordpress_api"
      SourceIngestors::WordpressApi.new(base_config)
    when "uploaded_files"
      nil
    else
      raise "No handler for source type #{source_type}"
    end
  end

  private

  def non_retryable_documents_payload
    non_retryable_documents.first(NON_RETRYABLE_DOCUMENTS_LIMIT).map do |document|
      {
        id: document.id,
        title: document.title,
        external_id: document.external_id,
        last_sync_error_code: document.last_sync_error_code,
        external_url: document.external_url
      }
    end
  end

  def check_plan_restrictions
    return if hub.can_add_source?
    errors.add(:base, hub.source_limit_error)
  end

  def schedule_ingestion
    SourceIngestionWorker.perform_async(id) if active? && !uploaded_files?
  end

  def title_exists?
    Source.exists?(name: title, hub: hub)
  end
end
