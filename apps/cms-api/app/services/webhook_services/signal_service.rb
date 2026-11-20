# Handles one event from signal-cli's event stream (relayed by SignalEventListener through SignalInboundWorker).
# Payload: {"envelope" => {...}, "account" => "<bot number>"}. Sample payloads: spec/files/signal/.
class WebhookServices::SignalService < WebhookServices::BaseService
  RECEIPT_RETRY_DELAY = 5.seconds

  def initialize(payload)
    super
    @integration = SignalMessagingIntegration.for_account(payload["account"])
  end

  def valid?
    @integration.present? && envelope["sourceUuid"].present?
  end

  # Anything else (syncMessage for activity on the linked phone, typingMessage, ...) is ignored
  def process
    return unless valid?
    @hub = @integration.hub

    if envelope["receiptMessage"].present?
      handle_receipt
    elsif data_message.present?
      handle_data_message
    end
  end

  private

  def envelope
    payload["envelope"].to_h
  end

  def data_message
    envelope["dataMessage"]
  end

  def handle_data_message
    # Groups are out of scope, and a disappearing-message timer change carries no content
    return if data_message["groupInfo"].present? || data_message["isExpirationUpdate"]

    reaction = data_message["reaction"]
    return process_reaction("Signal", reaction["emoji"], reaction["targetSentTimestamp"].to_s) if reaction.present?

    external_user = find_or_create_external_user(user_data)
    conversation = find_or_create_conversation(external_user)
    message_data = build_message_data(conversation)
    # The listener replays events after reconnecting, so the same message can arrive twice
    return if conversation.messages.exists?(external_id: message_data[:id])

    if unsupported_content?
      create_unsupported_message(conversation, message_data)
    elsif data_message["message"].present?
      create_message(conversation, message_data) unless handle_option_reply(conversation, message_data[:id])
    end
  end

  # A reply with the number of one of the options listed by MessageSenderServices::SignalService.
  # It isn't stored as a message, so a replayed or retried event is recognized by this marker instead.
  def handle_option_reply(conversation, external_id)
    handled_key = "signal_option_reply/#{external_id}"
    return true if Rails.cache.exist?(handled_key)

    callback_data = NumberedOptions.callback_for_reply(conversation, "signal_options", data_message["message"])
    return false if callback_data.blank?

    handle_button_callback(callback_data, conversation, data_message)
    Rails.cache.write(handled_key, true, expires_in: 1.day)
    true
  end

  def unsupported_content?
    %w[attachments sticker contacts].any? { |key| data_message[key].present? }
  end

  # Only delivery receipts are tracked, like on the other platforms. A receipt can arrive before the sender has
  # stored the message's id (signal-cli returns from a send after the recipient may already have confirmed it), so
  # unknown timestamps are looked up once more a bit later. Messages sent from the linked phone itself never match.
  def handle_receipt
    receipt = envelope["receiptMessage"]
    return unless receipt["isDelivery"]

    external_user = hub.external_users.find_by(platform: platform_name, external_id: envelope["sourceUuid"])
    conversation = external_user && hub.conversations.current_for(external_user, platform_name).take
    return if conversation.nil?

    unknown_timestamps = receipt["timestamps"].to_a.reject do |timestamp|
      external_id = SignalMessagingIntegration.message_external_id(conversation, timestamp)
      next false unless conversation.messages.outgoing.exists?(external_id: external_id)
      process_delivery_status_change(external_id, "delivered")
      true
    end
    return if unknown_timestamps.empty? || payload["receipt_retry"]

    retry_envelope = envelope.merge("receiptMessage" => receipt.merge("timestamps" => unknown_timestamps))
    SignalInboundWorker.perform_in(RECEIPT_RETRY_DELAY, payload.merge("envelope" => retry_envelope, "receipt_retry" => true).to_json)
  end

  # Users are identified by their account UUID: most hide their phone number, so sourceNumber is usually null
  def user_data
    {
      id: envelope["sourceUuid"],
      name: envelope["sourceName"],
      raw: envelope.slice("sourceUuid", "sourceNumber", "sourceName")
    }
  end

  def build_message_data(conversation)
    data = {
      id: SignalMessagingIntegration.message_external_id(conversation, data_message["timestamp"]),
      text: data_message["message"],
      raw: data_message
    }
    quoted_timestamp = data_message.dig("quote", "id")
    data[:reply_to_external_id] = SignalMessagingIntegration.message_external_id(conversation, quoted_timestamp) if quoted_timestamp
    data
  end

  def platform_name
    "signal"
  end
end
