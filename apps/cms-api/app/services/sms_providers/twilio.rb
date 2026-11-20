require "httparty"

module SmsProviders
  # Twilio adapter. The only concrete SmsProviders::Base implementation for now; Telnyx would be a
  # sibling class registered in SmsProviders::ADAPTERS.
  class Twilio < Base
    include HTTParty

    API_BASE = "https://api.twilio.com".freeze
    MESSAGING_BASE = "https://messaging.twilio.com".freeze
    CONTENT_BASE = "https://content.twilio.com".freeze

    NUMBER_RESOURCES = {"local" => "Local", "tollfree" => "TollFree", "mobile" => "Mobile"}.freeze

    # Twilio message status → Message enum symbol. Anything not listed (e.g. "receiving") is ignored.
    DELIVERY_STATUS_MAP = {
      "accepted" => :sent, "queued" => :sent, "sending" => :sent, "sent" => :sent,
      "delivered" => :delivered,
      "undelivered" => :failed, "failed" => :failed
    }.freeze

    # Account credentials are global (one Twilio account, Meedan as CSP); only the number and
    # optional messaging-service SID are per-tenant. The messaging service is a registration
    # artifact (recorded alongside brand/campaign SIDs), so it lives in the registration refs.
    # The RCS agent is likewise per-tenant — verified per hub and recorded on the integration's
    # settings as the RBM agent id (used in `rcs:` addressing, e.g. "acme_a1b2c3d4_agent"), not the
    # "XE…" sender-resource SID. Blank until a hub's agent is provisioned, which keeps that hub on
    # plain SMS. There is deliberately no global agent fallback: like messaging_service_sid, it is
    # on the record or absent (a shared agent couldn't route inbound RCS back to the right hub).
    def self.from_integration(integration)
      new(
        account_sid: ENV["TWILIO_ACCOUNT_SID"],
        auth_token: ENV["TWILIO_AUTH_TOKEN"],
        from_number: integration.get_credential(:phone_number),
        messaging_service_sid: integration.registration[:messaging_service_sid],
        rcs_agent_id: integration.get_setting(:rcs_agent_id)
      )
    end

    def initialize(account_sid:, auth_token:, from_number: nil, messaging_service_sid: nil, rcs_agent_id: nil)
      @account_sid = account_sid.to_s
      @auth_token = auth_token.to_s
      @from_number = from_number
      @messaging_service_sid = messaging_service_sid
      @rcs_agent_id = rcs_agent_id
    end

    def deliver(to:, body:, status_callback_url: nil, buttons: nil, fallback_text: nil)
      form = {"To" => to}
      # With buttons we send a Content template carrying an RCS quick-reply rendering plus a plain-text
      # fallback, so Twilio shows tappable buttons on RCS handsets and delivers `fallback_text` as SMS
      # otherwise. Without buttons it's an ordinary text send. Channel selection + SMS fallback are
      # Twilio's, driven by the messaging service the RCS agent is attached to.
      if buttons.present?
        form["ContentSid"] = create_card_content(body, buttons, fallback_text.presence || body)
      else
        form["Body"] = body
      end
      if @messaging_service_sid.present?
        form["MessagingServiceSid"] = @messaging_service_sid
      else
        form["From"] = @from_number
      end
      form["StatusCallback"] = status_callback_url if status_callback_url.present?

      response = post("#{API_BASE}/2010-04-01/Accounts/#{@account_sid}/Messages.json", body: form)
      raise Base::Error.new("Send failed: #{response.body}", safe_parse(response)["code"]) unless response.success?

      parsed = safe_parse(response)
      {external_id: parsed["sid"], status: DELIVERY_STATUS_MAP[parsed["status"].to_s.downcase]}
    end

    # Send an RCS "is typing" event from the agent to the recipient (Twilio v3 Typing Indicators API).
    # RCS-only and best-effort: Twilio decides RCS capability itself, so a non-RCS recipient simply
    # fails here and the caller (a fire-and-forget worker) logs and moves on.
    # `from`/`to` use RBM `rcs:` addressing — `from` is the agent id (matching the `From` on inbound
    # RCS, e.g. "rcs:acme_a1b2c3d4_agent"), not the "XE…" sender-resource SID.
    def send_typing_indicator(to:)
      raise Base::Error, "No RCS agent configured" if @rcs_agent_id.blank?

      response = self.class.post("#{MESSAGING_BASE}/v3/Indicators/Typing.json",
        body: {channel: "RCS", from: "rcs:#{@rcs_agent_id}", to: "rcs:#{to}", event: "START"}.to_json,
        headers: {"Content-Type" => "application/json"}, basic_auth: auth)
      raise Base::Error, "Typing indicator failed: #{response.body}" unless response.success?
    end

    # Twilio signs POST webhooks as Base64(HMAC-SHA1(auth_token, full_url + sorted POST params
    # concatenated as key+value)). The full URL must match the one configured on the number.
    def verify_signature(request)
      provided = request.headers["X-Twilio-Signature"].to_s
      return false if provided.blank? || @auth_token.blank?

      params = request.request_parameters
      data = request.original_url + params.sort_by(&:first).map { |key, value| "#{key}#{value}" }.join
      # nosemgrep: ruby.lang.security.weak-hashes-sha1.weak-hashes-sha1 -- HMAC-SHA1 is mandated by Twilio's signature scheme; compared with secure_compare
      expected = Base64.strict_encode64(OpenSSL::HMAC.digest("sha1", @auth_token, data))
      ActiveSupport::SecurityUtils.secure_compare(expected, provided)
    end

    def parse_inbound(request)
      params = request.request_parameters
      {
        # RCS addresses arrive `rcs:`-prefixed: From = "rcs:+15551234567", To = "rcs:<agent_id>".
        # Strip the prefix so an RCS sender maps to the same identity as their SMS number (From), and
        # the destination is a bare number/agent-id the webhook can match (To).
        from: strip_rcs_prefix(params["From"]),
        to: strip_rcs_prefix(params["To"]),
        body: params["Body"],
        # An RCS quick-reply tap carries the action's id in ButtonPayload (and its label in ButtonText).
        button_payload: params["ButtonPayload"],
        external_id: params["MessageSid"] || params["SmsSid"],
        raw: params
      }
    end

    def handle_status_callback(params)
      external_id = params["MessageSid"] || params["SmsSid"]
      status = DELIVERY_STATUS_MAP[(params["MessageStatus"] || params["SmsStatus"]).to_s.downcase]
      return nil if external_id.blank? || status.nil?
      error = {code: params["ErrorCode"], message: params["ErrorMessage"]}.compact.presence
      {external_id: external_id, status: status, error: error}.compact
    end

    def provision_number(country:, type: "tollfree", friendly_name: nil, region: nil, area_code: nil)
      resource = NUMBER_RESOURCES.fetch(type.to_s, "Local")
      query = {"SmsEnabled" => "true"}
      query["InRegion"] = region if region.present?
      query["AreaCode"] = area_code if area_code.present?
      search = get("#{API_BASE}/2010-04-01/Accounts/#{@account_sid}/AvailablePhoneNumbers/#{country}/#{resource}.json",
        query: query)
      raise Base::Error, "Number search failed: #{search.body}" unless search.success?

      number = safe_parse(search)["available_phone_numbers"].to_a.first&.dig("phone_number")
      raise Base::NoNumbersAvailable, "No available #{type} numbers for #{country}" if number.blank?

      body = {"PhoneNumber" => number}
      body["FriendlyName"] = friendly_name if friendly_name.present?
      purchase = post("#{API_BASE}/2010-04-01/Accounts/#{@account_sid}/IncomingPhoneNumbers.json", body: body)
      raise Base::Error, "Number purchase failed: #{purchase.body}" unless purchase.success?

      safe_parse(purchase)["phone_number"]
    end

    # Twilio updates a number by its resource SID (PN...), not the E.164 string, so we look the SID up
    # first, then set SmsUrl (inbound). Delivery-status callbacks are set per-message in #deliver, so
    # only the inbound URL is configured here.
    def configure_inbound_webhook(phone_number:, url:)
      sid = incoming_number_sid(phone_number)
      raise Base::Error, "Number #{phone_number} not found on account" if sid.blank?

      response = post("#{API_BASE}/2010-04-01/Accounts/#{@account_sid}/IncomingPhoneNumbers/#{sid}.json",
        body: {"SmsUrl" => url, "SmsMethod" => "POST"})
      raise Base::Error, "Webhook configuration failed: #{response.body}" unless response.success?
      url
    end

    # Reads live registration state from Twilio, dispatching on the stored regime. `refs` carries the
    # regime-specific references. NOTE: Twilio's compliance endpoint/field shapes should be validated
    # against a real account; the mappings below are deliberately isolated so they are cheap to adjust.
    def registration_status(refs)
      refs = refs.to_h.with_indifferent_access
      case refs[:registration_type]
      when "us_tollfree" then tollfree_status(refs)
      else a2p_status(refs)
      end
    end

    private

    # Toll-free verification: a single verification resource with one status.
    def tollfree_status(refs)
      verification_sid = refs[:tollfree_verification_sid]
      return "unregistered" if verification_sid.blank?

      case fetch_tollfree_status(verification_sid)
      when "TWILIO_APPROVED" then "approved"
      when "TWILIO_REJECTED" then "rejected"
      else "pending" # PENDING_REVIEW / IN_REVIEW
      end
    end

    # US A2P 10DLC: brand registration then campaign, mirrored onto our lifecycle.
    # Brand statuses: PENDING / IN_REVIEW / APPROVED / FAILED / DELETED.
    # Campaign statuses (campaign_status field): IN_PROGRESS / VERIFIED / FAILED / SUSPENDED.
    def a2p_status(refs)
      brand_sid = refs[:brand_sid]
      return "unregistered" if brand_sid.blank?

      brand_status = fetch_brand_status(brand_sid)
      return "rejected" if brand_status == "FAILED"
      return "unregistered" if brand_status == "DELETED"
      return "pending" unless brand_status == "APPROVED"

      campaign_sid = refs[:campaign_sid]
      service_sid = refs[:messaging_service_sid]
      return "brand_approved" if campaign_sid.blank? || service_sid.blank?

      case fetch_campaign_status(service_sid, campaign_sid)
      when "VERIFIED" then "approved"
      when "FAILED" then "rejected"
      when "SUSPENDED" then "suspended"
      else "campaign_pending"
      end
    end

    # Create a Content resource carrying an RCS rendering with tappable buttons plus a plain-text SMS
    # fallback, returning its ContentSid. Created per-message because our button ids/labels are dynamic.
    # RCS interactive buttons must use `twilio/card` (its `body` holds the RCS text) with QUICK_REPLY
    # actions — `twilio/quick-reply` renders buttons on WhatsApp/Messenger but NOT on RCS. Action titles
    # are capped at Twilio's 20-char limit.
    def create_card_content(body, buttons, fallback)
      payload = {
        friendly_name: "rcs_card_#{SecureRandom.hex(8)}",
        language: "en",
        types: {
          "twilio/card" => {
            body: body,
            actions: buttons.map { |button| {type: "QUICK_REPLY", title: button[:text].to_s.first(20), id: button[:id]} }
          },
          "twilio/text" => {body: fallback}
        }
      }
      response = self.class.post("#{CONTENT_BASE}/v1/Content",
        body: payload.to_json, headers: {"Content-Type" => "application/json"}, basic_auth: auth)
      raise Base::Error, "Content creation failed: #{response.body}" unless response.success?
      sid = safe_parse(response)["sid"]
      raise Base::Error, "Content creation returned no SID: #{response.body}" if sid.blank?
      sid
    end

    def strip_rcs_prefix(value)
      value.to_s.sub(/\Arcs:/, "")
    end

    def incoming_number_sid(phone_number)
      response = get("#{API_BASE}/2010-04-01/Accounts/#{@account_sid}/IncomingPhoneNumbers.json",
        query: {"PhoneNumber" => phone_number})
      raise Base::Error, "Number lookup failed: #{response.body}" unless response.success?
      safe_parse(response)["incoming_phone_numbers"].to_a.first&.dig("sid")
    end

    def fetch_tollfree_status(verification_sid)
      response = get("#{MESSAGING_BASE}/v1/Tollfree/Verifications/#{verification_sid}")
      raise Base::Error, "Toll-free verification lookup failed: #{response.body}" unless response.success?
      safe_parse(response)["status"].to_s.upcase
    end

    def fetch_brand_status(brand_sid)
      response = get("#{MESSAGING_BASE}/v1/a2p/BrandRegistrations/#{brand_sid}")
      raise Base::Error, "Brand lookup failed: #{response.body}" unless response.success?
      safe_parse(response)["status"].to_s.upcase
    end

    def fetch_campaign_status(service_sid, campaign_sid)
      response = get("#{MESSAGING_BASE}/v1/Services/#{service_sid}/Compliance/Usa2p/#{campaign_sid}")
      raise Base::Error, "Campaign lookup failed: #{response.body}" unless response.success?
      parsed = safe_parse(response)
      (parsed["campaign_status"] || parsed["status"]).to_s.upcase
    end

    def post(url, options = {})
      self.class.post(url, options.merge(basic_auth: auth))
    end

    def get(url, options = {})
      self.class.get(url, options.merge(basic_auth: auth))
    end

    def auth
      {username: @account_sid, password: @auth_token}
    end

    def safe_parse(response)
      JSON.parse(response.body)
    rescue
      {}
    end
  end
end
