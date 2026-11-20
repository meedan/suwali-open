class MessageSenderServices::SignalService < MessageSenderServices::BaseService
  def send_message
    integration = SignalMessagingIntegration.find_by(hub: hub, active: true)
    return if integration.nil?

    body = formatted_body
    text_style = (whole_text_style(body, "ITALIC") if @formatted)
    metadata = message.metadata.to_h

    # Signal has no tappable buttons, so interactive options become numbered instructions
    buttons = message.interactive_buttons
    if buttons.present?
      suffix, metadata["signal_options"] = NumberedOptions.render(buttons, conversation.language)
      body += suffix
    end

    timestamp = SignalService.new(integration.get_credential(:phone_number)).send_message(
      recipient: external_user.external_id,
      message: body,
      text_style: text_style
    )

    message.update!(status: :sent, external_id: SignalMessagingIntegration.message_external_id(conversation, timestamp), metadata: metadata)
  rescue => e
    message.update!(status: :failed)
    LogService.log :error, "MessageSenderServices::SignalService", "Exception on sending message #{message.id} to Signal: #{e.message}"
  end

  private

  # Signal styles text through ranges rather than markup, so italics are added in #send_message
  def format_italic(text)
    text
  end

  def whole_text_style(text, style)
    ["0:#{text.encode("UTF-16LE").bytesize / 2}:#{style}"]
  end
end
