class EmbedMessageWorker
  include Sidekiq::Worker
  sidekiq_options queue: :embeddings, retry: 3
  sidekiq_retry_in { |count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted do |msg, _exception|
    LogService.log(:error, "EmbedMessageWorker", "Retries exhausted after 3 attempts - Message ID: #{msg["args"][0]}, Job ID: #{msg["jid"]}")
  end

  def perform(message_id)
    message = Message.find(message_id)
    LogService.log(:info, "EmbedMessageWorker", "Generating embedding for message #{message_id}")

    message.get_and_store_embedding

    begin
      MessageClusterAssigner.new(message_id: message_id).call
    rescue => e
      LogService.log(:error, "EmbedMessageWorker",
        "Clustering failed for #{message_id}: #{e.class} - #{e.message}")
      raise e
    end
  rescue ActiveRecord::RecordNotFound
    LogService.log(:warn, "EmbedMessageWorker", "Message #{message_id} not found when generating embedding")
  rescue KnowledgeService::TooLongMessageError
    LogService.log(:warn, "EmbedMessageWorker", "Message #{message_id} body too long, skipping embedding and clustering")
  rescue => e
    LogService.log(:error, "EmbedMessageWorker", "Error generating embedding for message #{message_id}, will retry: #{e.class} - #{e.message}")
    raise e # Let Sidekiq handle retries
  end
end
