class BulkConversationExportWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  sidekiq_retries_exhausted do |msg, _exception|
    BulkConversationExport.find_by(id: msg["args"].first)&.failed!
    LogService.log(:error, "BulkConversationExportWorker", "Retries exhausted for bulk conversation export #{msg["args"].first}, Job ID: #{msg["jid"]}")
  end

  def perform(export_id)
    export = BulkConversationExport.find_by(id: export_id)
    return unless export&.pending?

    Tempfile.create(["bulk-conversation-export", ".csv"], encoding: "UTF-8") do |file|
      ConversationCsvExporter.new(export.conversations.find_each).write(file)
      # Without it, ActiveStorage checksums from EOF and the upload fails its integrity check
      file.rewind
      export.file.attach(io: file, filename: "suwali-hub-#{export.hub_id}-conversations-export-#{Date.today}.csv", content_type: "text/csv")
    end
    export.ready!
  end
end
