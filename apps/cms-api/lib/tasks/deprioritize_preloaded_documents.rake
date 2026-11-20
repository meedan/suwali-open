namespace :knowledge_service do
  # RAILS_ENV=production bundle exec rake knowledge_service:deprioritize_preloaded_documents
  #
  # Idempotent: documents already at the low tier are skipped, so a re-run does not pay for a
  # second round of ingestion.
  desc "Backfills the preloaded Suwali FAQ to the low priority tier and re-ingests it so Neo4j picks the tier up"
  task deprioritize_preloaded_documents: :environment do
    documents = Document.joins(:source)
      .where(sources: {preloaded: true, deleted_at: nil})
      .where(documents: {external_id: HubPreloadWorker::DOCUMENT_EXTERNAL_ID, active: true})
      .where.not(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_LOW)

    count = 0
    failures = 0
    documents.find_each do |document|
      previous_tier = document.priority_tier
      # update_columns skips the syncable callbacks so the ingest below is the only one enqueued
      document.update_columns(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_LOW, sync_status: :pending)
      begin
        KnowledgeServiceWorker.perform_async("ingest_document", document.id)
        count += 1
      rescue => e
        # Restore the tier so the skip-if-already-low guard above lets a re-run retry this document
        document.update_column(:priority_tier, previous_tier)
        failures += 1
        LogService.log(:error, "Rake Task: Deprioritize preloaded documents", "Failed to enqueue document #{document.id}: #{e.class} - #{e.message}")
      end
    end

    message = "Deprioritized and enqueued re-ingestion for #{count} preloaded FAQ document(s)"
    message += "; #{failures} failed to enqueue and were left for a re-run" if failures > 0
    puts message
    LogService.log(:info, "Rake Task: Deprioritize preloaded documents", message)
  end
end
