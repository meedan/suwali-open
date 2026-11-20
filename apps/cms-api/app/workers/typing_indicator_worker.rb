class TypingIndicatorWorker
  include Sidekiq::Worker
  # A typing indicator is ephemeral (it expires after a few seconds), so retrying later is pointless
  sidekiq_options queue: :messaging, retry: 0

  # WhatsApp/Telegram/Signal always support a free typing indicator. SMS supports one only via RCS, so a
  # plain-SMS conversation falls back to the intermediary message (handled by Message#acknowledge_receipt).
  def self.supports?(conversation)
    case conversation.platform
    when "whatsapp", "telegram", "signal"
      true
    when "sms"
      SmsMessagingIntegration.find_by(hub_id: conversation.hub_id, active: true)&.rcs_enabled? || false
    else
      false
    end
  end

  # `acknowledge` marks the initial receipt acknowledgement (vs. a periodic re-fire during processing);
  # only then does SMS fall back to an intermediary message if the RCS typing indicator can't be sent.
  def perform(message_id, acknowledge = false)
    message = Message.find_by(id: message_id)
    return unless message&.incoming?

    # If a reply (final answer) already exists, there is nothing being typed anymore
    return if message.reply.present?

    case message.conversation.platform
    when "whatsapp"
      send_whatsapp_typing_indicator(message)
    when "telegram"
      send_telegram_typing_indicator(message)
    when "sms"
      send_sms_typing_indicator(message, acknowledge)
    when "signal"
      send_signal_typing_indicator(message)
    end
  rescue => e
    LogService.log(:error, "TypingIndicatorWorker", "Failed to send typing indicator for message #{message_id}: #{e.message}")
  end

  private

  def send_whatsapp_typing_indicator(message)
    return if message.external_id.blank?

    integration = WhatsappMessagingIntegration.find_by(hub: message.hub)
    return if integration.nil?

    WhatsappService.new.send_typing_indicator(
      integration.get_credential(:phone_number_id),
      integration.get_credential(:business_token),
      message.external_id
    )
  end

  def send_telegram_typing_indicator(message)
    integration = TelegramMessagingIntegration.find_by(hub: message.hub)
    return if integration.nil?

    response = TelegramService.new(integration.get_credential(:bot_token)).send_chat_action(chat_id: message.conversation.participant.external_id)
    LogService.log(:error, "TypingIndicatorWorker", "Failed to send typing indicator for message #{message.id} to Telegram: #{response.body}") unless response.success?
  end

  def send_signal_typing_indicator(message)
    integration = SignalMessagingIntegration.find_by(hub: message.hub, active: true)
    return if integration.nil?

    SignalService.new(integration.get_credential(:phone_number)).send_typing(recipient: message.conversation.participant.external_id)
  end

  # Typing is an RCS-only affordance, so it only applies when the integration has an RCS agent.
  # When it can't be delivered (RCS agent not launched, or an SMS-fallback recipient), fall back — for
  # the initial acknowledgement only — to the intermediary message, so the user still gets a signal.
  def send_sms_typing_indicator(message, acknowledge)
    integration = SmsMessagingIntegration.find_by(hub: message.hub, active: true)
    return if integration.nil? || !integration.rcs_enabled?

    SmsProviders.for(integration).send_typing_indicator(to: message.conversation.participant.external_id)
  rescue => e
    LogService.log(:info, "TypingIndicatorWorker", "RCS typing unavailable for message #{message.id}: #{e.message}")
    message.send_acknowledgement_message if acknowledge
  end
end
