# RAILS_ENV=production bundle exec rake assign_published_at_to_drive_documents
#
# Makes one Drive API call per document (the created time is not stored in our database).
desc "Backfills published_at on Google Drive documents from the file's created time in Drive"
task assign_published_at_to_drive_documents: :environment do
  $stdout.sync = true
  sources = Source.not_deleted.where(source_type: "google_drive_folder")
  puts "Found #{Document.where(source: sources, published_at: nil).count} Google Drive document(s) without published_at"

  count = 0
  skipped = 0
  failures = []
  sources.find_each do |source|
    documents = source.documents.where(published_at: nil).select(:id, :external_id)
    next unless documents.exists?

    handler = source.handler
    documents.find_each do |document|
      published_at = Document.parse_published_at(handler.refetch_document_data(external_id: document.external_id)[:date])
      if published_at.nil?
        skipped += 1
        print "S"
        next
      end

      # skip callbacks so no Knowledge Service sync is enqueued and updated_at is kept
      document.update_columns(published_at: published_at)
      count += 1
      print "."
    rescue => e
      failures << "#{document.id} (#{document.external_id}): #{e.message}"
      print "F"
      LogService.log(:warn, "Rake Task: Assign published_at to Drive documents", "Skipping document #{document.id}: #{e.message}")
    end
  end

  puts
  failures.each { |failure| puts "Failed: #{failure}" }
  message = "Assigned published_at on #{count} Google Drive document(s), skipped #{skipped} (no date), failed #{failures.size}"
  puts message
  LogService.log(:info, "Rake Task: Assign published_at to Drive documents", message)
end
