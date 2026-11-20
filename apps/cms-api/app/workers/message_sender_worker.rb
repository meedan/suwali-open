class MessageSenderWorker
  include Sidekiq::Worker
  sidekiq_options queue: :messaging, retry: 3

  def perform(message_id)
    message = Message.find(message_id)
    return unless message.outgoing?

    service_class = case message.conversation.platform
    when "telegram"
      MessageSenderServices::TelegramService
    when "whatsapp"
      MessageSenderServices::WhatsappService
    when "sms"
      MessageSenderServices::SmsService
    when "signal"
      MessageSenderServices::SignalService
    else
      return # Unknown platform
    end

    service_class.new(message).send_message
  rescue => e
    LogService.log(:error, "MessageSenderWorker", e.message)
    raise e # Let Sidekiq handle retries
  end
end
