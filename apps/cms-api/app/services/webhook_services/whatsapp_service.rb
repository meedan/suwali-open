class WebhookServices::WhatsappService < WebhookServices::BaseService
  def initialize(app_secret, verify_token)
    @app_secret = app_secret.to_s
    @verify_token = verify_token.to_s
  end

  def handle_verification(params)
    mode = params["hub.mode"]
    token = params["hub.verify_token"].to_s
    challenge = params["hub.challenge"].to_s

    if mode == "subscribe" && secure_compare(token, @verify_token)
      [:ok, challenge, "text/plain"]
    else
      [:forbidden, "", "text/plain"]
    end
  end

  def valid?(request)
    header = request.headers["X-Hub-Signature-256"].to_s
    return false unless header.start_with?("sha256=")
    provided = header.split("sha256=").last
    return false if provided.blank? || @app_secret.blank?

    computed = OpenSSL::HMAC.hexdigest("SHA256", @app_secret, request.raw_post.to_s)
    secure_compare(provided, computed)
  end

  # Message types that represent user-sent content (the user expects a reply)
  USER_MESSAGE_TYPES = %w[text image video audio document sticker location contacts].freeze

  def valid_payload?(payload)
    return false unless payload.dig("object") == "whatsapp_business_account"

    message = payload.dig("entry", 0, "changes", 0, "value", "messages", 0)
    sender_identified = message&.key?("from") || message&.key?("from_user_id")

    # User-sent content (text or media)
    return true if sender_identified && USER_MESSAGE_TYPES.include?(message&.dig("type"))

    # Button reply validation (interactive reply buttons)
    return true if message&.dig("type") == "interactive" &&
      message&.dig("interactive", "type") == "button_reply" &&
      sender_identified

    # Template quick-reply button validation (e.g. topic notification templates)
    return true if message&.dig("type") == "button" &&
      message&.dig("button", "payload").present? &&
      sender_identified

    # Reaction validation
    return true if message&.dig("type") == "reaction" && sender_identified

    # Delivery status validation (failed or delivered)
    status = payload.dig("entry", 0, "changes", 0, "value", "statuses", 0, "status")
    return true if ["failed", "delivered"].include?(status) &&
      payload.dig("entry", 0, "changes", 0, "value", "statuses", 0, "id").present?

    false
  end

  def process(request)
    payload = JSON.parse(request.raw_post)
    return unless valid_payload?(payload)

    payload["entry"].each do |entry|
      entry["changes"].each do |change|
        next unless change["field"] == "messages"

        statuses = change.dig("value", "statuses")
        if statuses.present?
          process_delivery_statuses(statuses)
          next
        end

        phone_number_id = change.dig("value", "metadata", "phone_number_id")
        next if phone_number_id.blank?
        hub = find_hub_by_phone_number_id(phone_number_id)
        next unless hub

        contact = change.dig("value", "contacts", 0)
        message = change.dig("value", "messages", 0)

        external_user = find_or_create_external_user(user_data(contact))
        conversation = find_or_create_conversation(external_user)

        # Determine message type and handle accordingly
        if message["type"] == "reaction"
          process_reaction("WhatsApp", message.dig("reaction", "emoji"), message.dig("reaction", "message_id"))
          next
        elsif message["type"] == "interactive" && message.dig("interactive", "type") == "button_reply"
          callback_data = message.dig("interactive", "button_reply", "id")
          handle_button_callback(callback_data, conversation, message)
        elsif message["type"] == "button" && message.dig("button", "payload").present?
          callback_data = message.dig("button", "payload")
          handle_button_callback(callback_data, conversation, message)
        elsif ExternalUserCooldown.new(external_user).active?
          next
        elsif message.dig("text", "body").present?
          create_message(conversation, message_data(message))
        else
          create_unsupported_message(conversation, message_data(message))
        end
      end
    end
  end

  private

  def find_hub_by_phone_number_id(phone_number_id)
    integration = WhatsappMessagingIntegration.where(active: true).find { |i| i.get_credential(:phone_number_id) == phone_number_id }
    @hub = integration.hub unless integration.nil?
  end

  def process_delivery_statuses(statuses)
    statuses.each do |status|
      status_value = status["status"]
      next unless trackable_delivery_status?(status_value)
      process_delivery_status_change(status["id"], status_value, delivery_error(status))
    end
  end

  def delivery_error(status)
    error = status["errors"].to_a.first
    return if error.nil?
    {code: error["code"], message: error.dig("error_data", "details") || error["message"] || error["title"]}
  end

  def user_data(contact)
    wa_id = contact["wa_id"]
    bsuid = contact["user_id"]
    {
      id: wa_id || bsuid,
      name: contact.dig("profile", "name") || wa_id || bsuid,
      raw: contact
    }
  end

  def message_data(message)
    data = {
      id: message["id"],
      text: message.dig("text", "body"),
      raw: message
    }
    reply_to_message_id = message.dig("context", "id")
    data[:reply_to_external_id] = reply_to_message_id if reply_to_message_id
    data
  end

  def platform_name
    "whatsapp"
  end
end
