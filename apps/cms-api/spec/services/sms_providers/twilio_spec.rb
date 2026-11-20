require "rails_helper"

RSpec.describe SmsProviders::Twilio, type: :service do
  let(:account_sid) { "AC123" }
  let(:auth_token) { "test_auth_token" }
  let(:from_number) { "+15550001111" }
  let(:adapter) { described_class.new(account_sid: account_sid, auth_token: auth_token, from_number: from_number) }

  let(:messages_url) { "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/Messages.json" }

  # Minimal stand-in for an ActionDispatch::Request (headers, POST params, full URL).
  def build_request(headers: {}, params: {}, url: "https://example.com/api/webhooks/sms/1")
    instance_double(ActionDispatch::Request,
      headers: headers,
      request_parameters: params,
      original_url: url)
  end

  describe "#deliver" do
    it "sends via the From number and normalizes the response" do
      stub_request(:post, messages_url)
        .to_return(status: 201, body: {sid: "SM123", status: "queued"}.to_json, headers: {"Content-Type" => "application/json"})

      result = adapter.deliver(to: "+15557778888", body: "hello")

      expect(result).to eq(external_id: "SM123", status: :sent)
      expect(WebMock).to have_requested(:post, messages_url)
        .with(body: hash_including("From" => from_number, "To" => "+15557778888", "Body" => "hello"))
    end

    it "uses the messaging service SID when configured" do
      adapter = described_class.new(account_sid: account_sid, auth_token: auth_token, messaging_service_sid: "MG9")
      stub_request(:post, messages_url)
        .to_return(status: 201, body: {sid: "SM1", status: "sent"}.to_json)

      adapter.deliver(to: "+15557778888", body: "hi")

      expect(WebMock).to have_requested(:post, messages_url)
        .with(body: hash_including("MessagingServiceSid" => "MG9"))
        .with { |req| !req.body.include?("From=") }
    end

    it "includes the status callback URL when given" do
      stub_request(:post, messages_url).to_return(status: 201, body: {sid: "SM1", status: "queued"}.to_json)

      adapter.deliver(to: "+15557778888", body: "hi", status_callback_url: "https://example.com/status")

      expect(WebMock).to have_requested(:post, messages_url)
        .with(body: hash_including("StatusCallback" => "https://example.com/status"))
    end

    it "raises on provider failure, carrying Twilio's error code" do
      stub_request(:post, messages_url).to_return(status: 400, body: {code: 21211, message: "bad"}.to_json)

      expect { adapter.deliver(to: "+15557778888", body: "hi") }.to raise_error(SmsProviders::Base::Error, /Send failed/) { |error| expect(error.code).to eq(21211) }
    end

    context "with buttons (RCS card)" do
      let(:content_url) { "https://content.twilio.com/v1/Content" }
      let(:buttons) { [{id: "see_sources_5", text: "See sources"}] }

      it "creates a twilio/card template and sends it via ContentSid instead of a raw body" do
        stub_request(:post, content_url).to_return(status: 201, body: {sid: "HX1"}.to_json)
        stub_request(:post, messages_url).to_return(status: 201, body: {sid: "SM1", status: "queued"}.to_json)

        adapter.deliver(to: "+15557778888", body: "Answer", buttons: buttons, fallback_text: "Answer\n\nReply 1")

        expect(WebMock).to have_requested(:post, content_url).with { |req|
          body = JSON.parse(req.body)
          body.dig("types", "twilio/card", "body") == "Answer" &&
            body.dig("types", "twilio/card", "actions") == [{"type" => "QUICK_REPLY", "title" => "See sources", "id" => "see_sources_5"}] &&
            body.dig("types", "twilio/text", "body") == "Answer\n\nReply 1"
        }
        expect(WebMock).to have_requested(:post, messages_url)
          .with(body: hash_including("ContentSid" => "HX1")).with { |req| !req.body.include?("Body=") }
      end

      it "caps button titles at Twilio's 20-character limit" do
        stub_request(:post, content_url).to_return(status: 201, body: {sid: "HX1"}.to_json)
        stub_request(:post, messages_url).to_return(status: 201, body: {sid: "SM1", status: "queued"}.to_json)

        long_label = "A very long button label indeed"
        adapter.deliver(to: "+15557778888", body: "Answer", buttons: [{id: "x", text: long_label}])

        expect(WebMock).to have_requested(:post, content_url).with { |req|
          JSON.parse(req.body).dig("types", "twilio/card", "actions", 0, "title") == long_label.first(20)
        }
      end

      it "raises when content creation fails" do
        stub_request(:post, content_url).to_return(status: 400, body: {message: "bad"}.to_json)
        expect { adapter.deliver(to: "+15557778888", body: "Answer", buttons: buttons) }
          .to raise_error(SmsProviders::Base::Error, /Content creation failed/)
      end
    end

    it "tolerates a non-JSON success body" do
      stub_request(:post, messages_url).to_return(status: 201, body: "not json")

      expect(adapter.deliver(to: "+15557778888", body: "hi")).to eq(external_id: nil, status: nil)
    end
  end

  describe "#verify_signature" do
    let(:url) { "https://example.com/api/webhooks/sms/1" }
    let(:params) { {"To" => "+15550001111", "From" => "+15557778888", "Body" => "hi", "MessageSid" => "SM1"} }

    # Independently reconstruct Twilio's signing string: URL + POST params sorted by key, each as key+value.
    def expected_signature(token, url, params)
      data = url + params.sort_by(&:first).map { |k, v| "#{k}#{v}" }.join
      Base64.strict_encode64(OpenSSL::HMAC.digest("sha1", token, data))
    end

    it "accepts a correct signature" do
      signature = expected_signature(auth_token, url, params)
      request = build_request(headers: {"X-Twilio-Signature" => signature}, params: params, url: url)

      expect(adapter.verify_signature(request)).to be(true)
    end

    it "rejects a wrong signature" do
      request = build_request(headers: {"X-Twilio-Signature" => "wrong"}, params: params, url: url)
      expect(adapter.verify_signature(request)).to be(false)
    end

    it "rejects a tampered body" do
      signature = expected_signature(auth_token, url, params)
      tampered = params.merge("Body" => "tampered")
      request = build_request(headers: {"X-Twilio-Signature" => signature}, params: tampered, url: url)

      expect(adapter.verify_signature(request)).to be(false)
    end

    it "rejects a blank signature header" do
      request = build_request(headers: {"X-Twilio-Signature" => ""}, params: params, url: url)
      expect(adapter.verify_signature(request)).to be(false)
    end
  end

  describe "#parse_inbound" do
    it "normalizes Twilio form params" do
      request = build_request(params: {"From" => "+15557778888", "To" => "+15550001111", "Body" => "hello", "MessageSid" => "SM7"})

      expect(adapter.parse_inbound(request)).to include(
        from: "+15557778888",
        to: "+15550001111",
        body: "hello",
        external_id: "SM7"
      )
    end

    it "surfaces an RCS quick-reply tap's ButtonPayload" do
      request = build_request(params: {"From" => "+15557778888", "To" => "+15550001111", "ButtonPayload" => "see_sources_5", "ButtonText" => "See sources", "MessageSid" => "SM8"})

      expect(adapter.parse_inbound(request)).to include(button_payload: "see_sources_5")
    end

    it "strips the rcs: prefix so RCS from/to match SMS identity and the agent id" do
      request = build_request(params: {"From" => "rcs:+15557779999", "To" => "rcs:acme_agent", "Body" => "hi", "MessageSid" => "SM9"})

      expect(adapter.parse_inbound(request)).to include(from: "+15557779999", to: "acme_agent")
    end
  end

  describe "#handle_status_callback" do
    it "maps delivered" do
      expect(adapter.handle_status_callback("MessageSid" => "SM1", "MessageStatus" => "delivered"))
        .to eq(external_id: "SM1", status: :delivered)
    end

    it "maps failed and undelivered" do
      expect(adapter.handle_status_callback("MessageSid" => "SM1", "MessageStatus" => "undelivered")[:status]).to eq(:failed)
      expect(adapter.handle_status_callback("MessageSid" => "SM1", "MessageStatus" => "failed")[:status]).to eq(:failed)
    end

    it "includes the error code and message on a failure" do
      result = adapter.handle_status_callback("MessageSid" => "SM1", "MessageStatus" => "undelivered", "ErrorCode" => "30003", "To" => "+15550001111")
      expect(result).to eq(external_id: "SM1", status: :failed, error: {code: "30003"})
    end

    it "returns nil for an untracked status" do
      expect(adapter.handle_status_callback("MessageSid" => "SM1", "MessageStatus" => "receiving")).to be_nil
    end

    it "returns nil when the message SID is missing" do
      expect(adapter.handle_status_callback("MessageStatus" => "delivered")).to be_nil
    end
  end

  describe "#provision_number" do
    let(:search_url) { "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/AvailablePhoneNumbers/US/TollFree.json" }
    let(:purchase_url) { "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/IncomingPhoneNumbers.json" }

    it "searches for and buys an available number" do
      stub_request(:get, search_url).with(query: {"SmsEnabled" => "true"})
        .to_return(status: 200, body: {available_phone_numbers: [{phone_number: "+15551230000"}]}.to_json)
      stub_request(:post, purchase_url)
        .to_return(status: 201, body: {phone_number: "+15551230000"}.to_json)

      expect(adapter.provision_number(country: "US")).to eq("+15551230000")
      expect(WebMock).to have_requested(:post, purchase_url).with(body: hash_including("PhoneNumber" => "+15551230000"))
    end

    it "filters the search by region for local numbers" do
      local_search_url = "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/AvailablePhoneNumbers/US/Local.json"
      stub_request(:get, local_search_url).with(query: {"SmsEnabled" => "true", "InRegion" => "CA"})
        .to_return(status: 200, body: {available_phone_numbers: [{phone_number: "+15551230000"}]}.to_json)
      stub_request(:post, purchase_url)
        .to_return(status: 201, body: {phone_number: "+15551230000"}.to_json)

      expect(adapter.provision_number(country: "US", type: "local", region: "CA")).to eq("+15551230000")
    end

    it "filters the search by area code for local numbers" do
      local_search_url = "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/AvailablePhoneNumbers/US/Local.json"
      stub_request(:get, local_search_url).with(query: {"SmsEnabled" => "true", "AreaCode" => "718"})
        .to_return(status: 200, body: {available_phone_numbers: [{phone_number: "+17185550000"}]}.to_json)
      stub_request(:post, purchase_url)
        .to_return(status: 201, body: {phone_number: "+17185550000"}.to_json)

      expect(adapter.provision_number(country: "US", type: "local", area_code: "718")).to eq("+17185550000")
    end

    it "labels the number with the friendly name when given" do
      stub_request(:get, search_url).with(query: {"SmsEnabled" => "true"})
        .to_return(status: 200, body: {available_phone_numbers: [{phone_number: "+15551230000"}]}.to_json)
      stub_request(:post, purchase_url)
        .to_return(status: 201, body: {phone_number: "+15551230000"}.to_json)

      adapter.provision_number(country: "US", friendly_name: "Acme Hub")
      expect(WebMock).to have_requested(:post, purchase_url).with(body: hash_including("FriendlyName" => "Acme Hub"))
    end

    it "raises when no numbers are available" do
      stub_request(:get, search_url).with(query: {"SmsEnabled" => "true"})
        .to_return(status: 200, body: {available_phone_numbers: []}.to_json)

      expect { adapter.provision_number(country: "US") }.to raise_error(SmsProviders::Base::NoNumbersAvailable, /No available/)
    end

    it "raises when the search fails" do
      stub_request(:get, search_url).with(query: {"SmsEnabled" => "true"}).to_return(status: 500, body: "err")
      expect { adapter.provision_number(country: "US") }.to raise_error(SmsProviders::Base::Error, /search failed/)
    end
  end

  describe "#configure_inbound_webhook" do
    let(:lookup_url) { "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/IncomingPhoneNumbers.json" }
    let(:update_url) { "https://api.twilio.com/2010-04-01/Accounts/#{account_sid}/IncomingPhoneNumbers/PN1.json" }
    let(:webhook) { "https://example.com/api/webhooks/sms/9" }

    it "looks the number up by SID and sets its inbound SmsUrl" do
      stub_request(:get, lookup_url).with(query: {"PhoneNumber" => "+15551230000"})
        .to_return(status: 200, body: {incoming_phone_numbers: [{sid: "PN1"}]}.to_json)
      stub_request(:post, update_url).to_return(status: 200, body: {sid: "PN1"}.to_json)

      expect(adapter.configure_inbound_webhook(phone_number: "+15551230000", url: webhook)).to eq(webhook)
      expect(WebMock).to have_requested(:post, update_url)
        .with(body: hash_including("SmsUrl" => webhook, "SmsMethod" => "POST"))
    end

    it "raises when the number is not found on the account" do
      stub_request(:get, lookup_url).with(query: {"PhoneNumber" => "+15551230000"})
        .to_return(status: 200, body: {incoming_phone_numbers: []}.to_json)

      expect { adapter.configure_inbound_webhook(phone_number: "+15551230000", url: webhook) }
        .to raise_error(SmsProviders::Base::Error, /not found/)
    end

    it "raises when the update fails" do
      stub_request(:get, lookup_url).with(query: {"PhoneNumber" => "+15551230000"})
        .to_return(status: 200, body: {incoming_phone_numbers: [{sid: "PN1"}]}.to_json)
      stub_request(:post, update_url).to_return(status: 400, body: {message: "bad"}.to_json)

      expect { adapter.configure_inbound_webhook(phone_number: "+15551230000", url: webhook) }
        .to raise_error(SmsProviders::Base::Error, /configuration failed/)
    end
  end

  describe "#registration_status" do
    let(:brand_url) { "https://messaging.twilio.com/v1/a2p/BrandRegistrations/BN1" }
    let(:campaign_url) { "https://messaging.twilio.com/v1/Services/MG1/Compliance/Usa2p/CM1" }

    def stub_brand(status)
      stub_request(:get, brand_url).to_return(status: 200, body: {status: status}.to_json)
    end

    def stub_campaign(status)
      stub_request(:get, campaign_url).to_return(status: 200, body: {campaign_status: status}.to_json)
    end

    it "is unregistered without a brand reference" do
      expect(adapter.registration_status({})).to eq("unregistered")
    end

    it "is pending while the brand is under review" do
      stub_brand("PENDING")
      expect(adapter.registration_status(brand_sid: "BN1")).to eq("pending")
      stub_brand("IN_REVIEW")
      expect(adapter.registration_status(brand_sid: "BN1")).to eq("pending")
    end

    it "is unregistered when the brand was deleted" do
      stub_brand("DELETED")
      expect(adapter.registration_status(brand_sid: "BN1")).to eq("unregistered")
    end

    it "is brand_approved when the brand is approved but no campaign exists" do
      stub_brand("APPROVED")
      expect(adapter.registration_status(brand_sid: "BN1")).to eq("brand_approved")
    end

    it "is campaign_pending while the campaign is in progress" do
      stub_brand("APPROVED")
      stub_campaign("IN_PROGRESS")
      expect(adapter.registration_status(brand_sid: "BN1", campaign_sid: "CM1", messaging_service_sid: "MG1")).to eq("campaign_pending")
    end

    it "is approved when brand and campaign are cleared" do
      stub_brand("APPROVED")
      stub_campaign("VERIFIED")
      expect(adapter.registration_status(brand_sid: "BN1", campaign_sid: "CM1", messaging_service_sid: "MG1")).to eq("approved")
    end

    it "is rejected when the brand failed" do
      stub_brand("FAILED")
      expect(adapter.registration_status(brand_sid: "BN1")).to eq("rejected")
    end

    it "is rejected when the campaign failed" do
      stub_brand("APPROVED")
      stub_campaign("FAILED")
      expect(adapter.registration_status(brand_sid: "BN1", campaign_sid: "CM1", messaging_service_sid: "MG1")).to eq("rejected")
    end

    it "is suspended when the campaign is suspended" do
      stub_brand("APPROVED")
      stub_campaign("SUSPENDED")
      expect(adapter.registration_status(brand_sid: "BN1", campaign_sid: "CM1", messaging_service_sid: "MG1")).to eq("suspended")
    end

    context "with the toll-free regime" do
      let(:verification_url) { "https://messaging.twilio.com/v1/Tollfree/Verifications/HH1" }

      def tollfree_refs(extra = {})
        {registration_type: "us_tollfree"}.merge(extra)
      end

      def stub_verification(status)
        stub_request(:get, verification_url).to_return(status: 200, body: {status: status}.to_json)
      end

      it "is unregistered without a verification reference" do
        expect(adapter.registration_status(tollfree_refs)).to eq("unregistered")
      end

      it "is pending while the verification is under review" do
        stub_verification("IN_REVIEW")
        expect(adapter.registration_status(tollfree_refs(tollfree_verification_sid: "HH1"))).to eq("pending")
      end

      it "is approved when the verification is approved" do
        stub_verification("TWILIO_APPROVED")
        expect(adapter.registration_status(tollfree_refs(tollfree_verification_sid: "HH1"))).to eq("approved")
      end

      it "is rejected when the verification is rejected" do
        stub_verification("TWILIO_REJECTED")
        expect(adapter.registration_status(tollfree_refs(tollfree_verification_sid: "HH1"))).to eq("rejected")
      end

      it "raises when the verification lookup fails" do
        stub_request(:get, verification_url).to_return(status: 500, body: "err")
        expect { adapter.registration_status(tollfree_refs(tollfree_verification_sid: "HH1")) }
          .to raise_error(SmsProviders::Base::Error, /Toll-free verification lookup failed/)
      end
    end
  end

  describe "#send_typing_indicator" do
    let(:rcs_adapter) { described_class.new(account_sid: account_sid, auth_token: auth_token, rcs_agent_id: "acme_agent") }
    let(:typing_url) { "https://messaging.twilio.com/v3/Indicators/Typing.json" }

    it "posts an RCS typing event with the agent id and rcs-prefixed from/to" do
      stub_request(:post, typing_url).to_return(status: 200, body: {success: true}.to_json)

      rcs_adapter.send_typing_indicator(to: "+15557778888")

      expect(WebMock).to have_requested(:post, typing_url).with { |req|
        body = JSON.parse(req.body)
        body == {"channel" => "RCS", "from" => "rcs:acme_agent", "to" => "rcs:+15557778888", "event" => "START"}
      }
    end

    it "raises when no RCS agent is configured" do
      expect { adapter.send_typing_indicator(to: "+15557778888") }
        .to raise_error(SmsProviders::Base::Error, /No RCS agent/)
    end

    it "raises on provider failure" do
      stub_request(:post, typing_url).to_return(status: 400, body: "bad")
      expect { rcs_adapter.send_typing_indicator(to: "+15557778888") }
        .to raise_error(SmsProviders::Base::Error, /Typing indicator failed/)
    end
  end

  describe "SmsProviders.for" do
    it "builds the Twilio adapter from an integration using global account creds" do
      integration = instance_double("SmsMessagingIntegration")
      allow(integration).to receive(:get_credential).with(:provider).and_return("twilio")
      allow(integration).to receive(:get_credential).with(:phone_number).and_return(from_number)
      allow(integration).to receive(:registration).and_return({}.with_indifferent_access)
      allow(integration).to receive(:get_setting).with(:rcs_agent_id).and_return(nil)

      expect(SmsProviders.for(integration)).to be_a(described_class)
    end

    it "defaults to Twilio when no provider is set" do
      integration = instance_double("SmsMessagingIntegration")
      allow(integration).to receive(:get_credential).and_return(nil)
      allow(integration).to receive(:get_credential).with(:provider).and_return(nil)
      allow(integration).to receive(:registration).and_return({}.with_indifferent_access)
      allow(integration).to receive(:get_setting).with(:rcs_agent_id).and_return(nil)

      expect(SmsProviders.for(integration)).to be_a(described_class)
    end

    it "raises for an unknown provider" do
      integration = instance_double("SmsMessagingIntegration")
      allow(integration).to receive(:get_credential).with(:provider).and_return("carrier_pigeon")

      expect { SmsProviders.for(integration) }.to raise_error(SmsProviders::UnknownProviderError, /carrier_pigeon/)
    end
  end
end
