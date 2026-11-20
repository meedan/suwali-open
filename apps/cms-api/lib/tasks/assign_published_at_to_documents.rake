# RAILS_ENV=production bundle exec rake assign_published_at_to_documents
#
# Idempotent: only documents with a nil published_at are considered, and unparseable dates stay nil.
# Google Drive is skipped on purpose: its modified_time is not a publication date.
desc "Backfills published_at on RSS and JSON API documents from the date stored in their metadata"
task assign_published_at_to_documents: :environment do
  metadata_date_keys = {"rss_feed" => "published_at", "json_api" => "date"}

  count = 0
  metadata_date_keys.each do |source_type, metadata_key|
    # Select only what is read so the (large) content column is never loaded
    documents = Document.joins(:source).where(published_at: nil, sources: {source_type: source_type}).select(:id, :metadata)

    documents.find_each do |document|
      published_at = Document.parse_published_at(document.metadata.to_h[metadata_key])
      next if published_at.nil?

      # update_columns skips callbacks so no Knowledge Service sync is enqueued and updated_at is kept
      document.update_columns(published_at: published_at)
      count += 1
    end
  end

  message = "Assigned published_at on #{count} document(s)"
  puts message
  LogService.log(:info, "Rake Task: Assign published_at to documents", message)
end
