class SourceIngestionWorker
  include Sidekiq::Worker
  sidekiq_options queue: :source_ingestion, retry: 3

  MAX_NUMBER_OF_DOCUMENTS = 10_000
  STALE_INGESTION_THRESHOLD = 24.hours

  def perform(source_id)
    source = Source.find_by(id: source_id)
    return false if source.nil? || source.deleted? || source.uploaded_files?

    # Pause source if trial has expired
    if source.hub.blocks_creation_due_to_expired_trial?
      if source.active?
        source.update!(active: false)
        LogService.log(:info, "SourceIngestionWorker", "Paused Source ##{source.id} (#{source.name}) because trial has expired for Hub ##{source.hub.id} (#{source.hub.name})")
      end
      LogService.log(:info, "SourceIngestionWorker", "Not starting ingestion for Source ##{source.id} (#{source.name}) because trial has expired for Hub ##{source.hub.id} (#{source.hub.name})")
      return false
    end

    unless source.hub.can_add_document?
      LogService.log(:info, "SourceIngestionWorker", "Not starting ingestion for Source ##{source.id} (#{source.name}) because Hub plan doesn't allow it")
      return false
    end

    unless source.active?
      LogService.log(:info, "SourceIngestionWorker", "Not starting ingestion for Source ##{source.id} (#{source.name}) because it's not active")
      return false
    end

    # Atomically claim the ingestion slot to prevent concurrent runs.
    # A non-null ingestion_started_at means ingestion is in progress; treat it as stale after STALE_INGESTION_THRESHOLD.
    rows_updated = Source.where(id: source_id)
      .where("ingestion_started_at IS NULL OR ingestion_started_at < ?", STALE_INGESTION_THRESHOLD.ago)
      .update_all(ingestion_started_at: Time.current)
    if rows_updated == 0
      LogService.log(:info, "SourceIngestionWorker", "Skipping ingestion for Source ##{source.id} (#{source.name}) because it's already in progress")
      return false
    end

    LogService.log(:info, "SourceIngestionWorker", "Starting ingestion for Source ##{source.id} (#{source.name})")

    MetricsService.new(hub_id: source.hub_id).measure("source.pulled") do
      handler = source.handler
      documents, total, _suggested_name, errors = handler.call(
        existing_documents_scope: Document.where(source_id: source.id),
        deleted_documents_scope: DeletedDocument.where(source_id: source.id)
      )
      errors = errors.to_a

      number_of_documents_created = 0
      number_of_documents_failed = 0

      documents.first(MAX_NUMBER_OF_DOCUMENTS).each do |doc_data|
        document = source.documents.create!(
          external_id: doc_data[:external_id],
          title: doc_data[:title],
          content: doc_data[:content],
          metadata: doc_data[:metadata],
          document_type: doc_data[:document_type],
          published_at: Document.parse_published_at(doc_data[:date])
        )
        number_of_documents_created += 1

        if handler.respond_to?(:as_file)
          document.attach_file!(handler.as_file(doc_data)) # Path produced by internal handler, not user input
        end
      rescue => e
        number_of_documents_failed += 1
        errors << {external_id: doc_data[:external_id], title: doc_data[:title], link: doc_data[:link], reason: "import_failed", details: e.message}
        LogService.log(:error, "SourceIngestionWorker", "Failed to ingest document #{doc_data[:external_id]} for Source ##{source.id}: #{e.message}")
      end

      LogService.log(:info, "SourceIngestionWorker", "Ingestion complete for Source ##{source.id}: #{total} total, #{documents.size} returned, #{number_of_documents_created} created, #{number_of_documents_failed} failed, #{errors.size} not ingested")

      # Incremental syncs stop at the first already-imported item, so they never revisit earlier failures
      unless handler.try(:full_sync?)
        previous_errors = source.last_ingestion_errors.to_a
        reported_ids = errors.map { |error| error[:external_id] }
        imported_ids = source.documents.where(external_id: previous_errors.map { |error| error["external_id"] }).pluck(:external_id)
        # A failed page couldn't provide its selector-derived external_id, so the error is keyed by URL
        imported_links = source.documents.where("metadata->>'url' IN (?)", previous_errors.map { |error| error["link"] }).pluck(Arel.sql("metadata->>'url'"))
        errors += previous_errors.reject do |error|
          reported_ids.include?(error["external_id"]) || imported_ids.include?(error["external_id"]) || imported_links.include?(error["link"])
        end
      end

      source.update!(last_synced_at: Time.current, last_ingestion_errors: errors.first(MAX_NUMBER_OF_DOCUMENTS))
    rescue => e
      LogService.log(:error, "SourceIngestionWorker", "Ingestion failed for Source ##{source.id}: #{e.message}")
      raise e # Let Sidekiq handle retries
    ensure
      source.update_columns(ingestion_started_at: nil)
    end
  end
end
