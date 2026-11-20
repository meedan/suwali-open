class MessageSenderServices::TelegramService < MessageSenderServices::BaseService
  def send_message
    message_params = {
      chat_id: conversation.participant.external_id,
      text: formatted_body
    }
    message_params[:parse_mode] = "HTML" if @formatted

    # Add inline keyboard if message has interactive buttons
    buttons = message.interactive_buttons
    message_params[:reply_markup] = build_inline_keyboard(buttons) if buttons.present?

    response = telegram_client.send_message(**message_params)

    if response.success?
      message.update!(
        status: :sent,
        external_id: response.dig("result", "message_id")
      )
    else
      error = parsed_error_body(response)
      message.mark_as_failed!(code: error["error_code"] || response.code, message: error["description"])
      LogService.log :error, "MessageSenderServices::TelegramService", "Failed to send message #{message.id} to Telegram: #{response.body}"
    end
  rescue => e
    message.mark_as_failed!(message: e.message)
    LogService.log :error, "MessageSenderServices::TelegramService", "Exception on sending message #{message.id} to Telegram: #{e.message}"
  end

  private

  # Error bodies are not always JSON (e.g. a gateway's HTML error page)
  def parsed_error_body(response)
    parsed = response.parsed_response
    parsed.is_a?(Hash) ? parsed : {}
  end

  def format_italic(text)
    "<i>#{text}</i>"
  end

  def build_inline_keyboard(buttons)
    {
      inline_keyboard: [
        buttons.map { |button| {text: button[:text], callback_data: button[:id]} }
      ]
    }
  end

  def telegram_client
    @telegram_client ||= TelegramService.new(bot_token)
  end

  def bot_token
    integration = TelegramMessagingIntegration.find_by(hub: hub, active: true)
    return nil if integration.nil?
    integration.get_credential(:bot_token)
  end
end
