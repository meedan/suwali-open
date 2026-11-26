# RAILS_ENV=production bundle exec rake assign_public_url_to_documents
#
# Run once, right after deploy: a URL cleared by a user is nil too, so a rerun would refill it.
desc "Backfills public_url on documents from public sources from the url stored in their metadata"
task assign_public_url_to_documents: :environment do
  # The sources whose ingestors fill public_url on create
  source_types = %w[website rss_feed json_api wordpress_api]

  count = 0
  documents = Document.joins(:source).where(public_url: nil, sources: {source_type: source_types}).select(:id, :metadata)

  documents.find_each do |document|
    public_url = Document.usable_public_url(document.metadata.to_h["url"])
    next if public_url.nil?

    document.update_columns(public_url: public_url)
    count += 1
  end

  message = "Assigned public_url on #{count} document(s)"
  puts message
  LogService.log(:info, "Rake Task: Assign public_url to documents", message)
end
