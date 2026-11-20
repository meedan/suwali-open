namespace :topics do
  # One-off backfill of topics onto data source items that were ingested before the
  # topics feature shipped. Calls the Knowledge Service /topics endpoint, which extracts
  # topics from each item's already-ingested Neo4j chunks (no re-ingestion), and assigns
  # the returned topics. Idempotent and resumable: only items with no topics are processed.
  #
  # RAILS_ENV=production bundle exec rake topics:backfill
  desc "Backfill topics for already-ingested data source items via the Knowledge Service"
  task backfill: :environment do
    def log(message)
      puts message
      LogService.log(:info, "Rake Task: Backfill topics", message)
    end

    # Only items that were successfully ingested (present in Neo4j) and don't have topics yet.
    scopes = {
      "Document" => Document.where(active: true, sync_status: :complete).where.missing(:topic_items),
      "Notebook" => Notebook.where(active: true, published: true, sync_status: :complete).where.missing(:topic_items),
      "Contribution" => Contribution.where(active: true, sync_status: :complete).where.missing(:topic_items)
    }

    started = Time.now
    processed = 0
    assigned = 0
    errors = 0

    scopes.each do |class_name, scope|
      total = scope.count
      log "\n[#{Time.now}] #{class_name}: #{total} item(s) without topics to process"

      scope.find_each(batch_size: 100) do |record|
        hub = record.hub
        document_id = Base64.encode64("#{class_name}/#{record.id}")
        names = KnowledgeService.extract_topics(hub.id, document_id, hub.topic_names)

        if names.any?
          # Backfilling topics onto pre-existing items must not message topic subscribers.
          TopicItem.without_notifications { record.assign_topic_names(names) }
          assigned += 1
        end

        processed += 1
        print "."
      rescue => e
        errors += 1
        error_msg = "\n[ERROR] Failed to backfill topics for #{class_name} #{record.id}: #{e.message}"
        puts error_msg
        LogService.log(:error, "Rake Task: Backfill topics", error_msg)
      end
    end

    elapsed = Time.now - started
    minutes = (elapsed / 60).to_i
    seconds = (elapsed % 60).to_i

    log "\n" + "=" * 80
    log "TOPICS BACKFILL COMPLETE"
    log "=" * 80
    log "Total time:        #{minutes}m #{seconds}s"
    log "Items processed:   #{processed}"
    log "Items with topics: #{assigned}"
    log "Errors:            #{errors}"
    log "=" * 80

    if errors > 0
      log "\nWARNING: #{errors} item(s) failed. Review logs and re-run to retry (already-topiced items are skipped)."
    else
      log "\nSUCCESS: backfill complete."
    end
  end
end
