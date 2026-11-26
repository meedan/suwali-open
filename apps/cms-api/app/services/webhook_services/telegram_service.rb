class WebhookServices::TelegramService < WebhookServices::BaseService
  def initialize(payload)
    super
    @integration_id = payload["messaging_integration_id"]
  end

  def valid?
    payload.dig("message", "from", "id").present? ||
      (payload.dig("callback_query", "from", "id").present? && payload.dig("callback_query", "data").present?) ||
      payload.dig("message_reaction", "user", "id").present?
  end

  def process(token)
    return unless valid?
    return if token.blank?

    find_hub_by_integration_id_and_verify_token(token)
    return unless hub

    # Handle callback query
    if payload["callback_query"].present?
      handle_callback_query(token)
    # Handle reaction
    elsif payload["message_reaction"].present?
      handle_reaction
    # Handle regular message
    elsif payload["message"].present?
      handle_regular_message
    end
  end

  private

  def find_hub_by_integration_id_and_verify_token(received_token)
    @integration = TelegramMessagingIntegration.where(active: true, id: @integration_id).last
    return nil if @integration_id.nil? || @integration.nil?
    stored_token = @integration.get_credential("webhook_secret")
    @hub = @integration.hub if secure_compare(stored_token, received_token)
  end

  def user_data
    from = payload.dig("message", "from")
    {
      id: from["id"].to_s,
      name: [from["first_name"], from["last_name"]].compact.join(" "),
      raw: from
    }
  end

  def message_data
    message = payload["message"]
    data = {
      id: @integration.message_external_id(message["message_id"]),
      text: message["text"],
      raw: message
    }
    reply_to_message_id = message.dig("reply_to_message", "message_id")
    data[:reply_to_external_id] = @integration.message_external_id(reply_to_message_id) if reply_to_message_id
    data
  end

  def platform_name
    "telegram"
  end

  def handle_regular_message
    text = payload.dig("message", "text")
    return if text == "/start"

    external_user = find_or_create_external_user(user_data)
    conversation = find_or_create_conversation(external_user)
    text.present? ? create_message(conversation, message_data) : create_unsupported_message(conversation, message_data)
  end

  def handle_reaction
    # Uncomment the two lines below and build `user_data` once we do more stuff with reactions
    # external_user = find_or_create_external_user(user_data)
    # conversation = find_or_create_conversation(external_user)
    reaction = payload["message_reaction"]
    process_reaction("Telegram", reaction.dig("new_reaction", 0, "emoji"), reaction["message_id"].to_s)
  end

  def handle_callback_query(token)
    callback_query = payload["callback_query"]
    callback_data = callback_query["data"]
    from = callback_query["from"]
    callback_query_user_data = {
      id: from["id"].to_s,
      name: [from["first_name"], from["last_name"]].compact.join(" "),
      raw: from
    }

    # Extract user and conversation info
    external_user = find_or_create_external_user(callback_query_user_data)
    conversation = find_or_create_conversation(external_user)

    # Acknowledge callback query (removes loading state)
    telegram_client = TelegramService.new(@integration.get_credential(:bot_token))
    telegram_client.answer_callback_query(callback_query["id"])

    handle_button_callback(callback_data, conversation, callback_query)
  end
end
