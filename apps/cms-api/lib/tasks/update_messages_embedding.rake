# RAILS_ENV=production bundle exec rake update_messages_embedding:add_embedding_to_messages
# RAILS_ENV=production bundle exec rake update_messages_embedding:remove_embedding_from_messages
# Dry run by default (prints the count only); pass apply=true to actually update.
namespace :update_messages_embedding do
  desc "Generates and adds embedding vector to user messages"
  task add_embedding_to_messages: :environment do
    scope =
      Message.where(direction: "incoming", embedding: nil, state: :user_message)
        .where.not(body: [nil, ""])

    MessageEmbeddingTasks.process_messages(
      scope: scope,
      log_context: "Rake Task: Add embedding to incoming messages",
      label: "embed"
    ) { |message| message.get_and_store_embedding }
  end

  desc "Removes embedding vector from non-user messages"
  task remove_embedding_from_messages: :environment do
    scope = Message.where.not(state: :user_message).where.not(embedding: nil)

    MessageEmbeddingTasks.process_messages(
      scope: scope,
      log_context: "Rake Task: Remove embedding from non-user messages",
      label: "remove embedding from"
    ) { |message| message.update_columns(embedding: nil) }
  end
end

module MessageEmbeddingTasks
  def self.process_messages(scope:, log_context:, label:)
    log = lambda do |message|
      puts message
      LogService.log(:info, log_context, message)
    end

    started = Time.now
    updated_count = 0
    failed_count = 0
    failed_ids = []

    total_count = scope.count
    log.call "[#{Time.now}] Total of messages to #{label}: #{total_count}"

    return unless ENV["apply"] == "true"

    log.call "[#{Time.now}] Starting: #{label} for #{total_count} messages..."

    scope.find_in_batches(batch_size: 100) do |batch|
      batch.each do |message|
        yield message
        updated_count += 1
        print "."
      rescue => e
        failed_count += 1
        failed_ids << message.id
        error_msg = "\n[ERROR] Failed to #{label} message #{message.id}: #{e.message}"
        puts error_msg
        LogService.log(:error, log_context, error_msg)
      end

      puts "\nProcessed #{updated_count + failed_count}/#{total_count} messages..."
    end

    elapsed = Time.now - started
    minutes = (elapsed / 60).to_i
    seconds = (elapsed % 60).to_i

    log.call "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
    log.call "Successfully updated: #{updated_count} messages"

    if failed_count > 0
      log.call "Failed: #{failed_count} messages"
      log.call "Failed message IDs: #{failed_ids.join(", ")}"
    end
  end
end
