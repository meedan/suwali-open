# RAILS_ENV=production bundle exec rake normalize_message_external_ids
desc "Removes 'telegram.' and 'whatsapp.' prefixes from message external IDs"
task normalize_message_external_ids: :environment do
  def log(message, level: :info)
    puts message
    LogService.log(level, "Rake Task: Normalize message external IDs", message)
  end

  started = Time.now
  updated_count = 0
  failed_count = 0

  messages_to_process = Message.where("external_id LIKE 'telegram.%' OR external_id LIKE 'whatsapp.%'")
  total_count = messages_to_process.count

  log "[#{Time.now}] Normalizing external IDs for #{total_count} messages..."

  messages_to_process.find_in_batches(batch_size: 100) do |batch|
    batch.each do |message|
      new_id = message.external_id.sub(/\A(telegram|whatsapp)\./, "")
      message.update_column(:external_id, new_id)
      updated_count += 1
      print "."
    rescue => e
      failed_count += 1
      log "[ERROR] Failed to update message #{message.id}: #{e.message}", level: :error
    end

    puts "\nProcessed #{updated_count + failed_count}/#{total_count} messages..."
  end

  elapsed = Time.now - started
  minutes = (elapsed / 60).to_i
  seconds = (elapsed % 60).to_i

  log "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
  log "Successfully updated: #{updated_count} messages"
  log "Failed: #{failed_count} messages" if failed_count > 0
end
