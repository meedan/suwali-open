class HubPreloadWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  DOCUMENT_TITLE = "Suwali FAQ"
  DOCUMENT_EXTERNAL_ID = "preloaded"
  DOCUMENT_FILENAME = "suwali-faq.pdf"
  PDF_MAGIC_BYTES = "%PDF"

  def self.url
    ENV["PRELOADED_PDF_DOCUMENT_URL"].to_s
  end

  # Called in the foreground when a hub is created, and here as a fallback for the hubs that predate
  # that or had their source deleted
  def self.create_source!(hub)
    hub.sources.find_by(preloaded: true) || hub.sources.create!(
      name: I18n.t(:preloaded_source_title),
      source_type: :uploaded_files,
      active: true,
      preloaded: true
    )
  end

  def perform(hub_id, locale = nil)
    return if self.class.url.blank?

    hub = Hub.find_by(id: hub_id)
    return if hub.nil?
    return if preloaded_document(hub)&.file&.attached?
    # The source exists from the moment the hub is created, so it can be deleted while this job is
    # still downloading. Deletion is soft at first, and the lookups here would reuse or recreate it.
    return if hub.sources.where(preloaded: true).where.not(deleted_at: nil).exists?

    response = SourceIngestors::HttpClient.new(user_agent: Hub.user_agent_for(hub.id)).get(self.class.url)
    unless valid_pdf?(response, hub)
      discard_empty_source(hub)
      return
    end

    I18n.with_locale(locale.presence || I18n.default_locale) do
      create_source_with_document(hub, response.body)
    end

    LogService.log(:info, "HubPreloadWorker", "Preloaded data added to Hub ##{hub.id}")
  rescue => e
    LogService.log(:error, "HubPreloadWorker", "Failed to preload data for Hub ##{hub_id}: #{e.class} - #{e.message}")
    raise e # Let Sidekiq handle retries
  end

  private

  # A revoked or throttled link answers with an HTML page and a 200, so the body is checked too
  def valid_pdf?(response, hub)
    reason = if !response.success?
      "HTTP #{response.code}"
    elsif !response.content_type.to_s.include?("application/pdf")
      "unexpected content type #{response.content_type.presence || "(none)"}"
    elsif !response.body.to_s.start_with?(PDF_MAGIC_BYTES)
      "response body is not a PDF"
    end
    return true if reason.nil?

    LogService.log(:error, "HubPreloadWorker", "Not preloading data for Hub ##{hub.id}: #{reason} from #{self.class.url}")
    false
  end

  # A retry after a failed attachment reuses the source and document created by the previous attempt
  def preloaded_document(hub)
    Document.joins(:source).find_by(sources: {hub_id: hub.id, preloaded: true}, external_id: DOCUMENT_EXTERNAL_ID)
  end

  # A response that will never yield a document (a revoked link, say) would otherwise leave the source
  # created at hub creation empty and visible. A failed download is not discarded: Sidekiq retries it.
  def discard_empty_source(hub)
    source = hub.sources.find_by(preloaded: true)
    source.destroy! if source && source.documents.empty?
  end

  def create_source_with_document(hub, body)
    source = self.class.create_source!(hub)

    document = preloaded_document(hub) || begin
      new_document = source.documents.new(
        external_id: DOCUMENT_EXTERNAL_ID,
        title: DOCUMENT_TITLE,
        document_type: :pdf,
        priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_LOW
      )
      # The file is attached below, so ingestion is enqueued here instead of on the delay Document uses
      new_document.skip_automatic_ingestion = true
      new_document.save!
      new_document
    end

    document.file.attach(
      io: StringIO.new(body),
      filename: DOCUMENT_FILENAME,
      key: "documents/hub-#{hub.id}/document-#{document.id}.pdf",
      content_type: "application/pdf"
    )

    KnowledgeServiceWorker.perform_async("ingest_document", document.id)
  end
end
