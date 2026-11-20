# RAILS_ENV=production bundle exec rake backfill_answered_on_messages
desc "Backfills the answered column on outgoing messages based on their metadata"
task backfill_answered_on_messages: :environment do
  def log(message, level: :info)
    puts message
    LogService.log(level, "Rake Task: Backfill answered on messages", message)
  end

  started = Time.now
  updated_count = 0
  failed_count = 0
  failed_ids = []

  messages_to_process = Message
    .where(direction: "outgoing", answered: nil)
    .where("metadata->>'answerable' = 'true'")

  total_count = messages_to_process.count

  log "[#{Time.now}] Backfilling answered for #{total_count} outgoing messages..."

  messages_to_process.find_in_batches(batch_size: 100) do |batch|
    batch.each do |message|
      answered = message.metadata["error_type"].nil?
      message.update_column(:answered, answered)
      updated_count += 1
      print "."
    rescue => e
      failed_count += 1
      failed_ids << message.id
      log "[ERROR] Failed to update message #{message.id}: #{e.message}", level: :error
    end

    puts "\nProcessed #{updated_count + failed_count}/#{total_count} messages..."
  end

  elapsed = Time.now - started
  minutes = (elapsed / 60).to_i
  seconds = (elapsed % 60).to_i

  log "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
  log "Successfully updated: #{updated_count} messages"
  log "Failed: #{failed_count} messages. Failed message IDs: #{failed_ids.join(", ")}" if failed_count > 0
end
