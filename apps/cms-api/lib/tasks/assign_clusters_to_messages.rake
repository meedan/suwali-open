# RAILS_ENV=production bundle exec rake assign_clusters_to_messages
desc "Assign an existing or new cluster to an incoming message that has an embedding"
task assign_clusters_to_messages: :environment do
  def log(message)
    puts message
    LogService.log(:info, "Rake Task: Assign cluster to incoming messages", message)
  end

  started = Time.now
  updated_count = 0
  failed_count = 0
  failed_ids = []

  messages_to_process =
    Message
      .where(direction: "incoming", message_cluster_id: nil, state: :user_message)
      .where.not(embedding: nil)
  total_count = messages_to_process.count

  log "[#{Time.now}] Assigning clusters for #{total_count} messages..."

  messages_to_process.find_in_batches(batch_size: 100) do |batch|
    batch.each do |message|
      MessageClusterAssigner.new(message_id: message.id).call
      updated_count += 1
      print "."
    rescue => e
      failed_count += 1
      failed_ids << message.id
      error_msg = "\n[ERROR] Failed to assign cluster for message #{message.id}: #{e.message}"
      puts error_msg
      LogService.log(:error, "Rake Task: Assign clusters to incoming messages", error_msg)
    end

    puts "\nProcessed #{updated_count + failed_count}/#{total_count} messages..."
  end

  elapsed = Time.now - started
  minutes = (elapsed / 60).to_i
  seconds = (elapsed % 60).to_i

  log "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
  log "Successfully updated: #{updated_count} messages"

  if failed_count > 0
    log "Failed: #{failed_count} messages"
    log "Failed message IDs: #{failed_ids.join(", ")}"
  end
end
