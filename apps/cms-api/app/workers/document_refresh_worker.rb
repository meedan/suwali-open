class DocumentRefreshWorker
  include Sidekiq::Worker
  sidekiq_options queue: :source_ingestion, retry: 3

  def perform(document_id)
    document = Document.find_by(id: document_id)
    return unless document

    document.recreate!
  rescue => e
    LogService.log(:error, "DocumentRefreshWorker", "Failed to refresh document #{document_id}: #{e.message}")
    document&.update_column(:sync_status, :error)
  end
end
