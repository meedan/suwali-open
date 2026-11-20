class BulkConversationExportCleanupWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  def perform
    BulkConversationExport.expired_by_ttl.ready.find_each do |export|
      export.file.purge
      export.expired!
    end
    BulkConversationExport.expired_by_ttl.pending.find_each(&:failed!)
  end
end
