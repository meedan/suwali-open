class MessageSenderServices::SmsService < MessageSenderServices::BaseService
  # Twilio rejects message bodies longer than 1600 characters
  MAX_BODY_LENGTH = 1600

  def send_message
    integration = sms_integration
    return if integration.nil?

    # Compliance gates: a number must not send before its registration clears, and we never message
    # a number that has opted out (enforced here as well as in the inbound webhook).
    return block!("registration_not_approved") unless integration.approved_for_sending?
    return block!("recipient_opted_out") if external_user.opted_out?

    options = {}
    # render_body produces the numbered-instruction text (and populates `options`), which is the plain
    # SMS message and, under RCS, the fallback for recipients Twilio downgrades.
    body = render_body(options)

    deliver_args = {to: external_user.external_id, body: body, status_callback_url: integration.webhook_url}
    # With RCS enabled, additionally offer the raw buttons as tappable quick replies: the RCS rendering
    # uses the plain body, while the numbered text above rides along as the SMS fallback.
    buttons = message.interactive_buttons if integration.rcs_enabled?
    if buttons.present?
      deliver_args.merge!(body: truncate(formatted_body), buttons: buttons, fallback_text: body)
    end

    response = SmsProviders.for(integration).deliver(**deliver_args)

    metadata = message.metadata.to_h
    metadata["sms_options"] = options if options.present?
    message.update!(status: response[:status] || :sent, external_id: response[:external_id], metadata: metadata)
  rescue => e
    # Only the code: Twilio's error text can name the recipient
    message.mark_as_failed!(code: (e.code if e.is_a?(SmsProviders::Base::Error)))
    LogService.log :error, "MessageSenderServices::SmsService", "Exception on sending message #{message.id} to SMS: #{e.message}"
  end

  private

  # SMS can't render tappable buttons, so any interactive options become numbered instructions and
  # the number→callback map is stored on the message so an inbound reply can be routed back into the
  # existing button-callback flow (see NumberedOptions).
  def render_body(options)
    buttons = message.interactive_buttons
    return truncate(formatted_body) if buttons.blank?

    suffix, numbered_options = NumberedOptions.render(buttons, conversation.language)
    options.merge!(numbered_options)
    # The numbered option lines must survive intact for reply parsing, so only the body is truncated
    "#{truncate(formatted_body, reserve: suffix.length)}#{suffix}"
  end

  # Topic notifications are the recurring messages carriers scrutinize, so they must name the sender and say how to opt out
  def formatted_body
    body = super
    return body unless message.topic_notification?

    I18n.with_locale(conversation.language) { I18n.t(:sms_topic_notification, hub: hub.name, body: body, keyword: "STOP") }
  end

  def truncate(text, reserve: 0)
    # Twilio Smart Encoding expands "…" to "..." after our check, and "…" also forces UCS-2
    text = text.to_s.gsub("…", "...")
    limit = MAX_BODY_LENGTH - reserve
    (text.length <= limit) ? text : "#{text.first(limit - 3)}..."
  end

  def block!(reason)
    message.mark_as_failed!(code: reason)
    LogService.log :info, "MessageSenderServices::SmsService", "Not sending message #{message.id} to SMS: #{reason}"
  end

  def sms_integration
    SmsMessagingIntegration.find_by(hub: hub, active: true)
  end
end
