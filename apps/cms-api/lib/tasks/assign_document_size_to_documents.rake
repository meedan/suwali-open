# RAILS_ENV=production bundle exec rake assign_document_size_to_documents
desc "Backfills document size on documents"
task assign_document_size_to_documents: :environment do
  started_at = Time.now.to_i
  Document.where(document_size: nil).find_each do |document|
    document.send(:save_document_size)
    puts "Done for document ##{document.id}"
  end
  puts "Done in #{Time.now.to_i - started_at} seconds."
end
