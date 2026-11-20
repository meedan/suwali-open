class MessageSenderServices::WhatsappService < MessageSenderServices::BaseService
  def send_message
    integration = whatsapp_messaging_integration
    return if integration.nil?
    return message.mark_as_failed!(code: "rate_limit_cooldown") if cooldown.active?
    phone_number_id = integration.get_credential(:phone_number_id)
    business_token = integration.get_credential(:business_token)

    # Check if message has interactive buttons
    buttons = message.interactive_buttons

    recipient_id = conversation.participant.external_id

    template = message.whatsapp_template

    response = if template.present?
      whatsapp_client.send_template_message(
        phone_number_id,
        business_token,
        recipient_id,
        template[:name],
        template[:language],
        template[:parameters],
        template[:button_payloads]
      )
    elsif buttons.present?
      button_data = buttons.first
      whatsapp_client.send_interactive_message(
        phone_number_id,
        business_token,
        recipient_id,
        message.body,
        {id: button_data[:id], title: button_data[:text]}
      )
    else
      whatsapp_client.send_message(
        phone_number_id,
        business_token,
        recipient_id,
        formatted_body
      )
    end

    if response.success?
      message.update!(
        status: :sent,
        external_id: response.dig("messages", 0, "id")
      )
    else
      message.update!(status: :failed)
      LogService.log :error, "MessageSenderServices::WhatsappService", "Failed to send message #{message.id} to WhatsApp: #{response.body}"
    end
  rescue => e
    error = e.is_a?(WhatsappService::Error) ? {code: e.code, message: e.details} : {}
    message.mark_as_failed!(**error)
    LogService.log :error, "MessageSenderServices::WhatsappService", "Exception on sending message #{message.id} to WhatsApp: #{e.message}"
    handle_error(e)
  end

  private

  def handle_error(error)
    if error.is_a?(WhatsappService::Error) && error.code.to_i == WhatsappService::PAIR_RATE_LIMIT_ERROR_CODE
      cooldown.start!
    end
  end

  def cooldown
    @cooldown ||= ExternalUserCooldown.new(external_user)
  end

  def whatsapp_client
    @whatsapp_client ||= WhatsappService.new
  end

  def format_italic(text)
    "_#{text}_"
  end

  def whatsapp_messaging_integration
    WhatsappMessagingIntegration.find_by(hub: hub, active: true)
  end
end
