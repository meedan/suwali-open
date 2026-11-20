class DeliveryStatusChangeWorker
  include Sidekiq::Worker
  sidekiq_options queue: :messaging, retry: 1

  class SentMessageNotFound < StandardError; end

  ALLOWED_DELIVERY_STATUS_TRANSITIONS = {"sent" => %w[delivered failed], "failed" => %w[delivered]}.freeze

  sidekiq_retry_in { |_count, _exception, _jobhash| 3.seconds }

  sidekiq_retries_exhausted { |msg, _exception| LogService.log(:error, "DeliveryStatusChangeWorker", "Could not match message for delivery-status callback after retry: #{msg["args"]}") }

  def perform(message_external_id, status, error = nil)
    message = Message.find_by(external_id: message_external_id)
    raise SentMessageNotFound, "Sent message with external_id: #{message_external_id} was not found" unless message
    return unless ALLOWED_DELIVERY_STATUS_TRANSITIONS.fetch(message.status, []).include?(status)

    if status == "failed"
      message.mark_as_failed!(code: error&.dig("code"), message: error&.dig("message"))
      LogService.log(:error, "DeliveryStatusChangeWorker", "Delivery failed for message with ID #{message.id}: #{error&.dig("code")}")
    else
      message.update!(status: status.to_sym, metadata: message.metadata.to_h.except("delivery_error"))
    end
  end
end
