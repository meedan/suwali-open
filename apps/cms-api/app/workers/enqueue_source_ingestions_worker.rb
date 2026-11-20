class EnqueueSourceIngestionsWorker
  include Sidekiq::Worker
  sidekiq_options queue: :source_ingestion, retry: 0

  def perform
    Source.where(active: true)
      .where.not(source_type: Source.source_types[:uploaded_files])
      .where("ingestion_started_at IS NULL OR ingestion_started_at < ?", SourceIngestionWorker::STALE_INGESTION_THRESHOLD.ago)
      .find_each do |source|
        SourceIngestionWorker.perform_async(source.id)
      end
  end
end
