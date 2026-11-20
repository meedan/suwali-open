namespace :knowledge_service do
  # RAILS_ENV=production bundle exec rake knowledge_service:reset
  desc "Reset all knowledge syncable items to pending status"
  task reset: :environment do
    def log(message)
      puts message
      LogService.log(:info, "Rake Task: Reset knowledge syncable items", message)
    end

    started = Time.now

    log "[#{Time.now}] Resetting all eligible records to pending status..."

    # Documents: active only
    documents_count = 0
    Document.where(active: true).in_batches(of: 1000) do |batch|
      count = batch.update_all(sync_status: :pending)
      documents_count += count
      print "."
    end
    log "\nSet #{documents_count} active documents to pending"

    # Notebooks: active and published only
    notebooks_count = 0
    Notebook.where(active: true, published: true).in_batches(of: 1000) do |batch|
      count = batch.update_all(sync_status: :pending)
      notebooks_count += count
      print "."
    end
    log "\nSet #{notebooks_count} active published notebooks to pending"

    # Contributions: active only
    contributions_count = 0
    Contribution.where(active: true).in_batches(of: 1000) do |batch|
      count = batch.update_all(sync_status: :pending)
      contributions_count += count
      print "."
    end
    log "\nSet #{contributions_count} active contributions to pending"

    total_records = documents_count + notebooks_count + contributions_count

    elapsed = Time.now - started
    minutes = (elapsed / 60).to_i
    seconds = (elapsed % 60).to_i

    log "\n" + "=" * 80
    log "RESET COMPLETE"
    log "=" * 80
    log "Total time: #{minutes}m #{seconds}s"
    log ""
    log "SUMMARY:"
    log "  Documents:     #{documents_count}"
    log "  Notebooks:     #{notebooks_count}"
    log "  Contributions: #{contributions_count}"
    log "  TOTAL:         #{total_records}"
    log "=" * 80
    log "\nNext step: Run 'rake knowledge_service:reingest' to process pending records"
  end

  # RAILS_ENV=production bundle exec rake knowledge_service:reingest
  desc "Re-ingest all pending knowledge syncable items (idempotent - can be run multiple times)"
  task reingest: :environment do
    def log(message)
      puts message
      LogService.log(:info, "Rake Task: Re-ingest pending knowledge syncable items", message)
    end

    BATCH_SIZE = 100 # standard:disable Lint/ConstantDefinitionInBlock
    COMPLETION_THRESHOLD = 0.9 # standard:disable Lint/ConstantDefinitionInBlock
    POLL_INTERVAL = 5  # standard:disable Lint/ConstantDefinitionInBlock
    MAX_WAIT_TIME = 3000 # standard:disable Lint/ConstantDefinitionInBlock

    started = Time.now

    log "[#{Time.now}] Starting re-ingestion of pending records..."

    # Count initial pending records
    initial_pending_documents = Document.where(sync_status: :pending, active: true).count
    initial_pending_notebooks = Notebook.where(sync_status: :pending, active: true, published: true).count
    initial_pending_contributions = Contribution.where(sync_status: :pending, active: true).count
    initial_pending_total = initial_pending_documents + initial_pending_notebooks + initial_pending_contributions

    log "Found #{initial_pending_total} pending records:"
    log "  Documents:     #{initial_pending_documents}"
    log "  Notebooks:     #{initial_pending_notebooks}"
    log "  Contributions: #{initial_pending_contributions}"

    if initial_pending_total == 0
      log "\nNo pending records to process. Done!"
      return
    end

    log "\n[#{Time.now}] Processing records in batches of #{BATCH_SIZE}..."

    batch_number = 0

    loop do
      # Get next batch of pending records from all types
      pending_documents = Document.where(sync_status: :pending, active: true).limit(BATCH_SIZE)
      pending_notebooks = Notebook.where(sync_status: :pending, active: true, published: true).limit(BATCH_SIZE)
      pending_contributions = Contribution.where(sync_status: :pending, active: true).limit(BATCH_SIZE)

      # Collect all pending records
      all_pending = []
      all_pending.concat(pending_documents.to_a)
      all_pending.concat(pending_notebooks.to_a)
      all_pending.concat(pending_contributions.to_a)

      # Take only BATCH_SIZE records across all types
      current_batch = all_pending.first(BATCH_SIZE)

      break if current_batch.empty?

      batch_number += 1

      log "\n[#{Time.now}] Processing batch ##{batch_number} (#{current_batch.size} records)..."

      # Trigger re-ingestion for each record
      current_batch.each do |record|
        record.send(:send_to_knowledge_service)
        print "."
      rescue => e
        error_msg = "\n[ERROR] Failed to trigger re-ingestion for #{record.class.name} #{record.id}: #{e.message}"
        puts error_msg
        LogService.log(:error, "Rake Task: Re-ingest pending records", error_msg)
      end

      log "\n[#{Time.now}] Waiting for batch to complete (#{(COMPLETION_THRESHOLD * 100).to_i}% threshold)..."

      # Wait for 90% completion
      wait_start = Time.now
      loop do
        sleep POLL_INTERVAL

        # Count how many are no longer pending
        not_pending_count = current_batch.count do |record|
          record.reload
          record.sync_status != "pending"
        end

        completion_rate = not_pending_count.to_f / current_batch.size
        elapsed_wait = Time.now - wait_start

        print "."

        if completion_rate >= COMPLETION_THRESHOLD
          log "\n[#{Time.now}] Batch completed: #{not_pending_count}/#{current_batch.size} records processed (#{(completion_rate * 100).to_i}%)"
          break
        elsif elapsed_wait > MAX_WAIT_TIME
          log "\n[#{Time.now}] WARNING: Max wait time reached for batch. Moving to next batch..."
          log "Completion rate: #{not_pending_count}/#{current_batch.size} (#{(completion_rate * 100).to_i}%)"
          break
        end
      end
    end

    # Final statistics
    log "\n[#{Time.now}] Generating final statistics..."

    # Count current status of all eligible records (not just initially pending)
    final_documents_complete = Document.where(active: true, sync_status: :complete).count
    final_documents_error = Document.where(active: true, sync_status: :error).count
    final_documents_pending = Document.where(active: true, sync_status: :pending).count
    final_documents_total = final_documents_complete + final_documents_error + final_documents_pending

    final_notebooks_complete = Notebook.where(active: true, published: true, sync_status: :complete).count
    final_notebooks_error = Notebook.where(active: true, published: true, sync_status: :error).count
    final_notebooks_pending = Notebook.where(active: true, published: true, sync_status: :pending).count
    final_notebooks_total = final_notebooks_complete + final_notebooks_error + final_notebooks_pending

    final_contributions_complete = Contribution.where(active: true, sync_status: :complete).count
    final_contributions_error = Contribution.where(active: true, sync_status: :error).count
    final_contributions_pending = Contribution.where(active: true, sync_status: :pending).count
    final_contributions_total = final_contributions_complete + final_contributions_error + final_contributions_pending

    # Calculate totals
    total_complete = final_documents_complete + final_notebooks_complete + final_contributions_complete
    total_error = final_documents_error + final_notebooks_error + final_contributions_error
    total_pending = final_documents_pending + final_notebooks_pending + final_contributions_pending
    total_records = final_documents_total + final_notebooks_total + final_contributions_total

    elapsed = Time.now - started
    minutes = (elapsed / 60).to_i
    seconds = (elapsed % 60).to_i

    log "\n" + "=" * 80
    log "RE-INGESTION COMPLETE"
    log "=" * 80
    log "Total time: #{minutes}m #{seconds}s"
    log "Total batches processed: #{batch_number}"
    log ""
    log "DOCUMENTS (#{final_documents_total} total):"
    log "  Complete: #{final_documents_complete}"
    log "  Error:    #{final_documents_error}"
    log "  Pending:  #{final_documents_pending}"
    log ""
    log "NOTEBOOKS (#{final_notebooks_total} total):"
    log "  Complete: #{final_notebooks_complete}"
    log "  Error:    #{final_notebooks_error}"
    log "  Pending:  #{final_notebooks_pending}"
    log ""
    log "CONTRIBUTIONS (#{final_contributions_total} total):"
    log "  Complete: #{final_contributions_complete}"
    log "  Error:    #{final_contributions_error}"
    log "  Pending:  #{final_contributions_pending}"
    log ""
    log "OVERALL (#{total_records} total):"
    log "  Complete: #{total_complete}"
    log "  Error:    #{total_error}"
    log "  Pending:  #{total_pending}"
    log "=" * 80

    if total_error > 0
      log "\nWARNING: #{total_error} records failed to sync. Review logs and consider retrying."
    end

    if total_pending > 0
      log "\nINFO: #{total_pending} records still pending."
      log "You can run 'rake knowledge_service:reingest' again to continue processing."
    else
      log "\nSUCCESS: All records have been processed!"
    end
  end
end
