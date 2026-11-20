class ChatTimeoutWorker
  include Sidekiq::Worker
  sidekiq_options queue: :messaging, retry: 0

  def perform(message_id)
    message = Message.find_by(id: message_id)
    return unless message
    return unless message.direction == "incoming"

    # If a reply (final answer) already exists, nothing to do
    return if message.reply.present?

    # Safety net: create error message and release rate limiter
    message.conversation.messages.create!(
      direction: "outgoing",
      body: I18n.with_locale(message.conversation.language) { I18n.t(:error_create_chat_response_message) },
      state: :knowledge_service_error,
      reply_to: message
    )

    ConversationRateLimiter.new(message.conversation).release!

    LogService.log(:warn, "ChatTimeoutWorker", "Chat timeout safety net triggered for message #{message_id}")
  end
end
