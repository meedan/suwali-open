# RAILS_ENV=production bundle exec rake assign_reply_to_messages
desc "Backfills reply_to_id on bot reply messages by matching them to their preceding user message"
task assign_reply_to_messages: :environment do
  def log(message, level: :info)
    puts message
    LogService.log(level, "Rake Task: Assign reply_to to bot messages", message)
  end

  started = Time.now
  updated_count = 0
  skipped_count = 0
  skipped_ids = []
  failed_count = 0
  failed_ids = []

  messages_to_process =
    Message
      .where(direction: "outgoing", state: [:bot_message, :knowledge_service_error], reply_to_id: nil)
  total_count = messages_to_process.count

  log "[#{Time.now}] Assigning reply_to for #{total_count} bot messages..."

  messages_to_process.find_in_batches(batch_size: 100) do |batch|
    batch.each do |bot_reply|
      user_message = Message
        .where(conversation_id: bot_reply.conversation_id, direction: "incoming", state: :user_message)
        .where("id < ?", bot_reply.id)
        .order(id: :desc)
        .first

      next unless user_message

      bot_reply.update_column(:reply_to_id, user_message.id)
      updated_count += 1
      print "."
    rescue ActiveRecord::RecordNotUnique
      # user_message already has a reply assigned
      skipped_count += 1
      skipped_ids << bot_reply.id
      print "s"
    rescue => e
      failed_count += 1
      failed_ids << bot_reply.id

      log "[ERROR] Failed to assign reply_to for message #{bot_reply.id}: #{e.message}", level: :error
    end

    puts "\nProcessed #{updated_count + skipped_count + failed_count}/#{total_count} bot replies..."
  end

  elapsed = Time.now - started
  minutes = (elapsed / 60).to_i
  seconds = (elapsed % 60).to_i

  log "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
  log "Successfully updated: #{updated_count} messages"
  log "Skipped (user message already has a reply): #{skipped_count} messages. IDs: #{skipped_ids.join(", ")}" if skipped_count > 0
  log "Failed: #{failed_count} messages. Failed message IDs: #{failed_ids.join(", ")}" if failed_count > 0
end
