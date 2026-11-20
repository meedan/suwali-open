class WelcomeMessageWorker
  include Sidekiq::Worker
  # A retried welcome could arrive after the answer
  sidekiq_options queue: :messaging, retry: 0

  def perform(message_id)
    incoming_message = Message.find_by(id: message_id)
    return unless incoming_message
    # Sidekiq can run a job twice (e.g. requeued on shutdown); don't welcome or start the chat again
    return if incoming_message.conversation.messages.bot_welcome_message.where("id > ?", message_id).exists?

    welcome(incoming_message)
    # Started here rather than with the incoming message so the answer can't arrive before the welcome
    KnowledgeServiceWorker.perform_async("chat", message_id)
  end

  private

  def welcome(incoming_message)
    conversation = incoming_message.conversation
    hub = conversation.hub
    language = detect_language(incoming_message.body, hub) unless hub.single_language?
    conversation.update_language(language) if SUPPORTED_LANGUAGES.key?(language.to_s)

    body = hub.first_message_for_conversation(conversation.language)
    conversation.messages.create!(direction: "outgoing", body: body, state: :bot_welcome_message)
  rescue => e
    LogService.log(:error, "WelcomeMessageWorker", "Failed to generate first message for hub #{hub&.id}: #{e.message}")
    incoming_message.acknowledge_receipt
  end

  def detect_language(text, hub)
    KnowledgeService.detect_language(text, hub.default_language, hub.supported_languages)
  rescue KnowledgeService::Error => e
    LogService.log(:warn, "WelcomeMessageWorker", "Language detection failed for hub #{hub.id}: #{e.message}")
    nil
  end
end
