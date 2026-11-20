class WebhookServices::SmsService < WebhookServices::BaseService
  # Carrier-reserved keywords. Twilio auto-handles these at the account level (Advanced Opt-Out),
  # but we enforce opt-out in our own workflow too so the send path never messages a stopped number.
  OPT_OUT_KEYWORDS = %w[stop stopall unsubscribe cancel end quit].freeze
  OPT_IN_KEYWORDS = %w[start unstop yes].freeze
  HELP_KEYWORDS = %w[help info].freeze

  def initialize(integration_id)
    @integration = SmsMessagingIntegration.where(active: true, id: integration_id).last
  end

  # One endpoint handles both inbound messages and delivery-status callbacks (they can share a URL,
  # like the WhatsApp webhook). The signature must always check out; a status callback is then valid
  # on its own, while an inbound message must also come from a sender to this integration's number.
  def valid?(request)
    return false unless valid_signature?(request)
    return true if status_callback?(request)

    inbound = parse(request)
    inbound[:from].present? && addressed_to_integration?(inbound[:to])
  end

  def process(request)
    return process_status_callback(request) if status_callback?(request)

    inbound = parse(request)
    @hub = @integration.hub
    external_user = find_or_create_external_user(user_data(inbound))

    keyword = inbound[:body].to_s.strip.downcase
    if OPT_OUT_KEYWORDS.include?(keyword)
      external_user.opt_out!
      return
    elsif OPT_IN_KEYWORDS.include?(keyword)
      external_user.opt_in!
      return
    end

    # Never engage a stopped number, and let the carrier answer HELP.
    return if external_user.opted_out?
    return if HELP_KEYWORDS.include?(keyword)

    conversation = find_or_create_conversation(external_user)
    # An RCS quick-reply tap returns the button's id as the body; a plain-SMS reply to the numbered
    # fallback returns a digit. Handle both before treating the text as a normal inbound message.
    return if handle_rcs_button_reply(conversation, inbound)
    return if handle_option_reply(conversation, inbound)

    inbound[:body].present? ? create_message(conversation, message_data(inbound)) : create_unsupported_message(conversation, message_data(inbound))
  end

  private

  # An inbound is for this integration if it's addressed to its SMS number, or — for RCS — to its
  # agent id. On RCS inbound the To is the agent (surfaced by #parse_inbound without the "rcs:" prefix),
  # not the number, so a plain number match alone would (wrongly) reject every RCS message.
  def addressed_to_integration?(to)
    return true if normalize_number(to) == normalize_number(@integration.get_credential(:phone_number))
    @integration.rcs_enabled? && to == @integration.get_setting(:rcs_agent_id)
  end

  # Twilio sends MessageStatus only on delivery-status callbacks; inbound messages don't carry it.
  def status_callback?(request)
    request.request_parameters["MessageStatus"].present?
  end

  def valid_signature?(request)
    return false if @integration.nil?
    provider.verify_signature(request)
  end

  def process_status_callback(request)
    result = provider.handle_status_callback(request.request_parameters)
    return if result.nil? || !trackable_delivery_status?(result[:status].to_s)

    process_delivery_status_change(result[:external_id], result[:status].to_s, result[:error])
  end

  def provider
    @provider ||= SmsProviders.for(@integration)
  end

  def parse(request)
    @parsed ||= {}
    @parsed[request.object_id] ||= provider.parse_inbound(request)
  end

  # An RCS quick-reply tap arrives with the button's callback id in ButtonPayload (surfaced by the
  # provider's #parse_inbound). That id already carries the well-known prefixes the shared callback
  # handler dispatches on, so we route straight into it — no per-message option map needed (unlike SMS).
  def handle_rcs_button_reply(conversation, inbound)
    payload = inbound[:button_payload].to_s.strip
    return false if payload.blank?

    handle_button_callback(payload, conversation, inbound[:raw])
    true
  end

  # SMS has no tappable buttons, so option-bearing outgoing messages carry an sms_options map
  # ("1" => callback_data) rendered as numbered instructions (see MessageSenderServices::SmsService).
  # A reply matching one of those numbers is translated back into the existing button-callback flow.
  def handle_option_reply(conversation, inbound)
    callback_data = NumberedOptions.callback_for_reply(conversation, "sms_options", inbound[:body])
    return false if callback_data.blank?

    handle_button_callback(callback_data, conversation, inbound[:raw])
    true
  end

  def user_data(inbound)
    {id: inbound[:from], name: inbound[:from], raw: inbound[:raw]}
  end

  def message_data(inbound)
    {id: inbound[:external_id], text: inbound[:body], raw: inbound[:raw]}
  end

  def platform_name
    "sms"
  end

  def normalize_number(number)
    number.to_s.gsub(/[^\d+]/, "")
  end
end
