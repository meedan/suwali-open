class Document < ApplicationRecord
  include SoftDeletable::Child
  include NotebookItemable
  include MessageDataSourceItemable
  include Topicable
  include KnowledgeServiceSyncable
  include TrialRestrictable

  class RefreshNotSupportedError < StandardError; end

  # The summary is prepended to the document's text on ingestion, which fails if the whole text is too large.
  # Sent to the frontend by the about endpoint, for it to show how much is left.
  MAX_SUMMARY_LENGTH = 2000

  belongs_to :source, counter_cache: true
  delegate :hub, to: :source
  has_one_attached :file

  # Set by callers that attach the file themselves and enqueue the ingestion right afterwards, so they
  # don't pay the delay that gives the upload time to finish (see method #send_to_knowledge_service)
  attr_accessor :skip_automatic_ingestion

  scope :accessible_by, ->(user) {
    if user.is_admin
      all
    else
      joins(:source).where(sources: {hub_id: user.hub_memberships.approved.select(:hub_id)})
    end
  }

  scope :ordered_by_published_at, ->(direction) {
    direction = (direction == "asc") ? "ASC" : "DESC"
    order(Arel.sql("documents.published_at #{direction} NULLS LAST, documents.updated_at #{direction}, documents.id #{direction}"))
  }

  # Source types whose documents are public-facing and can be shared back to end users.
  PUBLIC_SOURCE_TYPES = ["rss_feed", "website", "json_api", "wordpress_api"].freeze

  # Documents from public-facing sources that can be shared back to end users.
  scope :public_source, -> {
    where(active: true, source_id: Source.where(source_type: PUBLIC_SOURCE_TYPES))
  }

  def self.parse_published_at(value)
    case value
    when String then Time.zone.parse(value)
    when Time, DateTime then value.in_time_zone
    end
  rescue ArgumentError
    nil
  end

  # In-memory counterpart of the public_source scope (no query when source is already loaded).
  def public_source?
    active && PUBLIC_SOURCE_TYPES.include?(source&.source_type)
  end

  TYPES = {
    pdf: 0,
    doc: 1,
    blog_post: 2,
    docx: 3,
    txt: 4,
    rss_entry: 5,
    json: 6,
    md: 7,
    markdown: 8
  }

  enum document_type: TYPES

  validates :title, :document_type, presence: true
  validates :summary, length: {maximum: MAX_SUMMARY_LENGTH}
  validates :external_id, uniqueness: {scope: :source_id}, allow_nil: true
  validate :check_plan_restrictions, on: :create

  validates_parent_not_deleted :source

  after_commit :send_to_knowledge_service, on: :create
  after_destroy :create_deleted_document
  after_commit :remove_from_knowledge_service, on: :destroy
  # Generates the AI summary to fall back to if the summary was cleared, then updates the summaries of the notebooks holding the document
  after_commit :enqueue_item_summary_generation, on: :update, if: :saved_change_to_summary?
  after_rollback :purge_orphaned_blob

  def as_json(_options = {})
    super.merge({external_url: external_url, document_size: human_readable_document_size, file_url: proxied_url, topics: sorted_topic_items, refresh_supported: refresh_supported?})
  end

  def refresh_supported?
    return false if error? || pending?
    source.handler.try(:refresh_supported?) == true
  rescue
    false
  end

  def external_url
    metadata.to_h.dig("url") || metadata.to_h.dig("drive_url")
  end

  include ActionView::Helpers::NumberHelper
  def human_readable_document_size
    document_size ? number_to_human_size(document_size) : ""
  end

  def text_for_summarization
    content
  end

  def summarize_ingested_content
    return unless active? && complete? # skip the round-trip before chunks are ingested
    KnowledgeService.summarize(hub_id: hub.id, document_id: Base64.encode64("Document/#{id}"), default_language: hub.default_language)
  end

  def retry_item_summary_generation
    enqueue_item_summary_generation if effective_summary.blank?
  end

  def awaiting_sync_for_summary?
    active? && pending? && content.blank? && effective_summary.blank?
  end

  def effective_summary
    summary.presence || ai_summary
  end

  # Summary length sized so a full digest of 10 items (title + snippet + URL each) fits the 4096
  # character message limit (see WebhookServices::BaseService::MAX_TEXT_MESSAGE_LENGTH).
  CONTENT_SNIPPET_LENGTH = 150

  # The first words of the content, used as the item summary in the "See More" sources list,
  # collapsed to a single line.
  def content_snippet
    content.to_s.gsub(/\s+/, " ").strip.truncate(CONTENT_SNIPPET_LENGTH, separator: " ", omission: "…")
  end

  def attach_file!(file_path)
    file.purge if file.attached?
    file_io = File.open(file_path)
    blob = ActiveStorage::Blob.create_and_upload!(
      io: file_io,
      filename: File.basename(file_path),
      key: "documents/hub-#{source.hub_id}/document-#{id}#{File.extname(file_path)}",
      content_type: Marcel::MimeType.for(Pathname.new(file_path))
    )
    @blob_pending_attachment = blob
    file.attach(blob)
    update_column(:document_size, blob.byte_size.to_i)
  ensure
    file_io&.close
    File.delete(file_path) if File.exist?(file_path)
  end

  def data_source_payload
    {
      content: content,
      document_type: document_type,
      external_url: external_url,
      document_size: document_size,
      updated_at: updated_at,
      active: active,
      priority_tier: priority_tier
    }
  end

  def proxied_url(expires_in: 24.hours, host: ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000"))
    blob = file&.blob
    return nil if blob.nil?
    Rails.application.routes.url_helpers.rails_storage_proxy_url(
      blob,
      expires_in: expires_in,
      disposition: :attachment,
      filename: blob.filename,
      host: host
    )
  end

  def file_missing?
    !file.attached? || !file.blob.service.exist?(file.blob.key)
  end

  def reattach_file!
    return if source.uploaded_files? || source.google_drive_folder?
    return unless file_missing?

    doc_data = {title: title, content: content, date: published_at}
    attach_file!(source.handler.as_file(doc_data))
  end

  def recreate!
    handler = source.handler
    raise RefreshNotSupportedError unless handler.respond_to?(:refetch_document_data)

    doc_data = handler.refetch_document_data(refresh_payload)
    transaction do
      # file.attach resets dirty-tracking, so it must run before update! sets saved_change_to_content?
      attach_file!(handler.as_file(doc_data))
      update!(title: doc_data[:title], content: doc_data[:content], metadata: doc_data[:metadata])
    end
  end

  private

  def refresh_payload
    if source.website?
      {url: metadata.to_h["url"]}
    elsif source.google_drive_folder? || source.wordpress_api?
      {external_id: external_id}
    elsif source.rss_feed?
      {url: metadata.to_h["url"], title: title, metadata: metadata.to_h}
    end
  end

  def purge_orphaned_blob
    return unless @blob_pending_attachment
    @blob_pending_attachment.service.delete(@blob_pending_attachment.key)
    @blob_pending_attachment = nil
  end

  def send_to_knowledge_service
    return if skip_automatic_ingestion
    # The file is attached only after the record is created (its id is part of the blob key), and
    # ingestion is skipped when there is no file yet, so give the upload time to finish
    KnowledgeServiceWorker.perform_in(30.seconds, "ingest_document", id)
  end

  def enqueue_item_summary_generation
    notebook_items.each { |notebook_item| ItemSummaryWorker.perform_async("Document", id, notebook_item.notebook_id) }
  end

  def remove_from_knowledge_service
    KnowledgeServiceWorker.perform_in(30.seconds, "delete_document", id, hub.id)
  end

  def knowledge_service_sync_required?
    super || ((saved_change_to_content? || saved_change_to_summary?) && active?)
  end

  def create_deleted_document
    DeletedDocument.create!(source_id: source_id, external_id: external_id) unless destroyed_by_association
  end

  def check_plan_restrictions
    return if hub.can_add_document?
    errors.add(:base, hub.document_limit_error)
  end
end
