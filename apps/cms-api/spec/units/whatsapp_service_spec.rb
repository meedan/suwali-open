require_relative "../unit_spec_helper"
require_relative "../../app/services/whatsapp_service"

require "webmock/rspec"

RSpec.describe WhatsappService do
  let(:service) { described_class.new }

  before do
    WebMock.disable_net_connect!(allow_localhost: true)

    # Mock environment variables
    allow(ENV).to receive(:fetch).with("WHATSAPP_API_BASE", "https://graph.facebook.com").and_return("https://graph.facebook.com")
    allow(ENV).to receive(:fetch).with("WHATSAPP_API_VERSION", "v21.0").and_return("v21.0")
    allow(ENV).to receive(:fetch).with("WHATSAPP_APP_ID").and_return("test_app_id")
    allow(ENV).to receive(:fetch).with("WHATSAPP_APP_SECRET").and_return("test_app_secret")
    allow(ENV).to receive(:[]).with("WHATSAPP_SYSTEM_USER_ID").and_return("system_user_id")
    allow(ENV).to receive(:[]).with("WHATSAPP_SYSTEM_TOKEN").and_return("system_token")
    allow(ENV).to receive(:[]).with("WHATSAPP_CREDIT_LINE_ID").and_return("credit_line_id")
  end

  after do
    WebMock.reset!
  end

  describe "#exchange_code_for_business_token" do
    let(:code) { "test_auth_code" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/oauth/access_token" }

    def stub_token_exchange(endpoint, code, status:, body:)
      stub_request(:get, endpoint)
        .with(query: {
          client_id: "test_app_id",
          client_secret: "test_app_secret",
          code: code
        })
        .to_return(status: status, body: body, headers: {"Content-Type" => "application/json"})
    end

    it "successfully exchanges code for business token" do
      stub_token_exchange(endpoint, code, status: 200, body: {access_token: "business_token_123"}.to_json)

      token = service.exchange_code_for_business_token(code)

      expect(token).to eq("business_token_123")
    end

    it "raises just the status code when the body carries no Graph error object" do
      stub_token_exchange(endpoint, code, status: 400, body: {error: "invalid_code"}.to_json)

      expect {
        service.exchange_code_for_business_token(code)
      }.to raise_error(WhatsappService::Error, "Token exchange failed: code=400")
    end

    it "raises error when access_token is blank" do
      stub_token_exchange(endpoint, code, status: 200, body: {access_token: ""}.to_json)

      expect {
        service.exchange_code_for_business_token(code)
      }.to raise_error(WhatsappService::Error, /Token exchange failed/)
    end

    it "logs token_type and expires_in, never the access_token" do
      logger = spy("logger")
      service_with_logger = described_class.new(logger)
      stub_token_exchange(endpoint, code, status: 200, body: {access_token: "business_token_123", token_type: "bearer", expires_in: 5183999}.to_json)

      service_with_logger.exchange_code_for_business_token(code)

      expect(logger).to have_received(:log).with(:info, "WhatsappService", "Token exchange response: code=200 token_type=bearer expires_in=5183999")
    end

    it "raises a sanitized error message that never carries the raw response body or Graph's free-text error message" do
      stub_token_exchange(endpoint, code, status: 400, body: {access_token: "", error: {message: "Invalid code: #{code}", type: "OAuthException", code: 190, fbtrace_id: "Abc123", raw_token_leak: "secret_token_123"}}.to_json)

      expect {
        service.exchange_code_for_business_token(code)
      }.to raise_error(WhatsappService::Error, "Token exchange failed: code=400 type=OAuthException code=190 fbtrace_id=Abc123")
    end
  end

  describe "#subscribe_waba" do
    let(:waba_id) { "waba_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{waba_id}/subscribed_apps" }

    it "successfully subscribes WABA" do
      stub_request(:post, endpoint)
        .with(headers: {"Authorization" => "Bearer #{business_token}"})
        .to_return(
          status: 200,
          body: {success: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      result = service.subscribe_waba(waba_id, business_token)

      expect(result).to be true
    end

    it "raises error when subscription fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: "subscription_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.subscribe_waba(waba_id, business_token)
      }.to raise_error(WhatsappService::Error, /WABA subscription failed/)
    end
  end

  describe "#share_credit_line" do
    let(:waba_id) { "waba_123" }
    let(:business_token) { "business_token_123" }
    let(:add_user_endpoint) { "https://graph.facebook.com/v21.0/#{waba_id}/assigned_users?user=system_user_id&tasks=['MANAGE_BILLING']&access_token=system_token" }
    let(:share_credit_endpoint) { "https://graph.facebook.com/v21.0/credit_line_id/whatsapp_credit_sharing_and_attach?waba_currency=USD&waba_id=#{waba_id}" }

    it "successfully shares credit line" do
      stub_request(:post, add_user_endpoint)
        .to_return(
          status: 200,
          body: {success: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      stub_request(:post, share_credit_endpoint)
        .with(headers: {"Authorization" => "Bearer system_token"})
        .to_return(
          status: 200,
          body: {success: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      result = service.share_credit_line(waba_id, business_token)

      expect(result).to be true
    end

    it "raises error when adding system user fails" do
      stub_request(:post, add_user_endpoint)
        .to_return(
          status: 400,
          body: {error: "add_user_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.share_credit_line(waba_id, business_token)
      }.to raise_error(WhatsappService::Error, /Adding system user to WABA failed/)
    end

    it "raises error when sharing credit line fails" do
      stub_request(:post, add_user_endpoint)
        .to_return(status: 200, body: {success: true}.to_json)

      stub_request(:post, share_credit_endpoint)
        .to_return(
          status: 400,
          body: {error: "sharing_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.share_credit_line(waba_id, business_token)
      }.to raise_error(WhatsappService::Error, /Sharing credit line failed/)
    end
  end

  describe "#fetch_phone_number" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}" }

    it "successfully fetches phone number" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "display_phone_number"}
        )
        .to_return(
          status: 200,
          body: {display_phone_number: "+1234567890"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      phone_number = service.fetch_phone_number(phone_number_id, business_token)

      expect(phone_number).to eq("+1234567890")
    end

    it "raises error when fetch fails" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "display_phone_number"}
        )
        .to_return(
          status: 400,
          body: {error: "fetch_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.fetch_phone_number(phone_number_id, business_token)
      }.to raise_error(WhatsappService::Error, /Fetch phone number failed/)
    end

    it "logs only the status code, never the phone number" do
      logger = spy("logger")
      service_with_logger = described_class.new(logger)
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "display_phone_number"}
        )
        .to_return(
          status: 200,
          body: {display_phone_number: "+1234567890"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service_with_logger.fetch_phone_number(phone_number_id, business_token)

      expect(logger).to have_received(:log).with(:info, "WhatsappService", "Phone number fetching response: code=200")
    end
  end

  describe "#fetch_phone_number_status" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}" }

    it "successfully fetches phone number status" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "quality_rating,status,account_mode,name_status"}
        )
        .to_return(
          status: 200,
          body: {
            quality_rating: "GREEN",
            status: "CONNECTED",
            account_mode: "LIVE",
            name_status: "APPROVED"
          }.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      status = service.fetch_phone_number_status(phone_number_id, business_token)

      expect(status).to eq({
        quality_rating: "GREEN",
        status: "CONNECTED",
        account_mode: "LIVE",
        name_status: "APPROVED"
      })
    end

    it "raises error when fetch fails" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "quality_rating,status,account_mode,name_status"}
        )
        .to_return(
          status: 400,
          body: {error: "fetch_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.fetch_phone_number_status(phone_number_id, business_token)
      }.to raise_error(WhatsappService::Error, /Fetch phone number status failed/)
    end

    it "handles missing fields gracefully" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "quality_rating,status,account_mode,name_status"}
        )
        .to_return(
          status: 200,
          body: {quality_rating: "GREEN"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      status = service.fetch_phone_number_status(phone_number_id, business_token)

      expect(status).to eq({
        quality_rating: "GREEN",
        status: nil,
        account_mode: nil,
        name_status: nil
      })
    end
  end

  describe "#fetch_business_verification_status" do
    let(:waba_id) { "waba_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{waba_id}" }

    it "successfully fetches business verification status" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "business_verification_status"}
        )
        .to_return(
          status: 200,
          body: {business_verification_status: "verified"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      status = service.fetch_business_verification_status(waba_id, business_token)

      expect(status).to eq("VERIFIED")
    end

    it "raises error when fetch fails" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "business_verification_status"}
        )
        .to_return(
          status: 400,
          body: {error: "fetch_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.fetch_business_verification_status(waba_id, business_token)
      }.to raise_error(WhatsappService::Error, /Fetch business verification status failed/)
    end

    it "returns nil when field is missing" do
      stub_request(:get, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}"},
          query: {fields: "business_verification_status"}
        )
        .to_return(
          status: 200,
          body: {id: waba_id}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      status = service.fetch_business_verification_status(waba_id, business_token)

      expect(status).to be_nil
    end
  end

  describe "#register_phone_number" do
    let(:phone_number_id) { "phone_123" }
    let(:pin) { "123456" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}/register" }

    it "successfully registers phone number" do
      stub_request(:post, endpoint)
        .with(
          headers: {
            "Authorization" => "Bearer #{business_token}",
            "Content-Type" => "application/json"
          },
          body: {
            messaging_product: "whatsapp",
            pin: pin
          }.to_json
        )
        .to_return(
          status: 200,
          body: {success: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      result = service.register_phone_number(phone_number_id, pin, business_token)

      expect(result).to be true
    end

    it "raises error when registration fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: "registration_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.register_phone_number(phone_number_id, pin, business_token)
      }.to raise_error(WhatsappService::Error, /Phone number registration failed/)
    end
  end

  describe "#send_message" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:to) { "+1234567890" }
    let(:text) { "Hello, World!" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}/messages" }

    it "successfully sends message to phone number using 'to' param" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "msg_123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_message(phone_number_id, business_token, to, text)

      expect(response.code).to eq(200)
      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["to"] == to && !body.key?("recipient")
        }
    end

    it "sends message to BSUID using 'recipient' param" do
      bsuid = "US.1349120865530274"
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "msg_456"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_message(phone_number_id, business_token, bsuid, text)

      expect(response.code).to eq(200)
      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["recipient"] == bsuid && !body.key?("to")
        }
    end

    it "raises error when send message fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: "send_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_message(phone_number_id, business_token, to, text)
      }.to raise_error(WhatsappService::Error, /Send message failed/)
    end

    it "carries the Graph error code on the raised error" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {message: "Too many messages", code: WhatsappService::PAIR_RATE_LIMIT_ERROR_CODE}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_message(phone_number_id, business_token, to, text)
      }.to raise_error(WhatsappService::Error) { |error| expect(error.code).to eq(WhatsappService::PAIR_RATE_LIMIT_ERROR_CODE) }
    end

    it "carries Meta's error details on the raised error but not in its message" do
      details = "Param text['body'] must be at most 4096 characters long."
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {message: "(#100) Invalid parameter", code: 100, error_data: {details: details}}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_message(phone_number_id, business_token, to, text)
      }.to raise_error(WhatsappService::Error) { |error|
        expect(error.details).to eq(details)
        expect(error.message).not_to include(details)
      }
    end

    it "logs the WhatsApp message id, never the recipient" do
      logger = spy("logger")
      service_with_logger = described_class.new(logger)
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {contacts: [{input: to, wa_id: "1234567890"}], messages: [{id: "wamid.ABC123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service_with_logger.send_message(phone_number_id, business_token, to, text)

      expect(logger).to have_received(:log).with(:info, "WhatsappService", "Send message response: code=200 message_id=wamid.ABC123")
    end
  end

  describe "#send_typing_indicator" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:message_id) { "wamid.ABC123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}/messages" }

    it "marks the message as read and sends the typing indicator" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {success: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      result = service.send_typing_indicator(phone_number_id, business_token, message_id)

      expect(result).to be true
      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["status"] == "read" &&
            body["message_id"] == message_id &&
            body["typing_indicator"] == {"type" => "text"}
        }
    end

    it "raises error when sending typing indicator fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: "typing_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_typing_indicator(phone_number_id, business_token, message_id)
      }.to raise_error(WhatsappService::Error, /Send typing indicator failed/)
    end
  end

  describe "#safe_parse" do
    it "parses valid JSON" do
      response = double("response", body: '{"key": "value"}')
      result = service.send(:safe_parse, response)
      expect(result).to eq({"key" => "value"})
    end

    it "returns empty hash for invalid JSON" do
      response = double("response", body: "invalid json")
      result = service.send(:safe_parse, response)
      expect(result).to eq({})
    end
  end

  describe "#send_interactive_message" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:to) { "+1234567890" }
    let(:text) { "Hello, World!" }
    let(:button_data) { {id: "button_123", title: "Click Me"} }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}/messages" }

    before do
      # Define truncate method for pure Ruby environment (without Rails/ActiveSupport)
      unless String.method_defined?(:truncate)
        String.class_eval do
          def truncate(truncate_at, options = {})
            return dup unless length > truncate_at

            omission = options.fetch(:omission, "...")
            length_with_room_for_omission = truncate_at - omission.length
            stop = length_with_room_for_omission

            "#{self[0, stop]}#{omission}"
          end
        end
      end
    end

    it "successfully sends interactive message with button" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "wamid.123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_interactive_message(phone_number_id, business_token, to, text, button_data)

      expect(response.code).to eq(200)
      expect(response.parsed_response["messages"].first["id"]).to eq("wamid.123")

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["messaging_product"] == "whatsapp" &&
            body["type"] == "interactive" &&
            body["interactive"]["type"] == "button" &&
            body["interactive"]["body"]["text"] == text &&
            body["interactive"]["action"]["buttons"].first["reply"]["id"] == "button_123"
        }
        .once
    end

    it "raises error when send interactive message fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: "send_failed"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_interactive_message(phone_number_id, business_token, to, text, button_data)
      }.to raise_error(WhatsappService::Error, /Send interactive message failed/)
    end

    it "truncates text to 1024 characters" do
      long_text = "a" * 2000

      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "wamid.123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.send_interactive_message(phone_number_id, business_token, to, long_text, button_data)

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["interactive"]["body"]["text"].length == 1024
        }
        .once
    end

    it "truncates button title to 20 characters" do
      long_button_data = {id: "button_123", title: "a" * 50}

      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "wamid.123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.send_interactive_message(phone_number_id, business_token, to, text, long_button_data)

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          button_title = body["interactive"]["action"]["buttons"].first["reply"]["title"]
          button_title.length == 20 && button_title.end_with?("...")
        }
        .once
    end
  end

  describe "#create_message_template" do
    def capture_error
      yield
    rescue WhatsappService::Error => e
      e
    end

    let(:waba_id) { "waba_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{waba_id}/message_templates" }
    let(:components) { [{type: "BODY", text: "New update about {{1}}"}] }

    it "successfully creates a message template" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {id: "template_123", status: "PENDING", category: "UTILITY"}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      result = service.create_message_template(waba_id, business_token, "topic_notification_v1", "en", "UTILITY", components)

      expect(result).to eq(true)
      expect(WebMock).to have_requested(:post, endpoint)
        .with(
          headers: {"Authorization" => "Bearer #{business_token}", "Content-Type" => "application/json"},
          body: {
            name: "topic_notification_v1",
            language: "en",
            category: "UTILITY",
            components: components
          }.to_json
        )
        .once
    end

    it "raises error when template creation fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {message: "Invalid template"}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.create_message_template(waba_id, business_token, "topic_notification_v1", "en", "UTILITY", components)
      }.to raise_error(WhatsappService::Error, /Create message template failed/)
    end

    it "flags a category mismatch error and keeps the subcode in the message" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {type: "OAuthException", code: 100, error_subcode: 2388026, fbtrace_id: "trace_1"}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      error = capture_error { service.create_message_template(waba_id, business_token, "topic_notification_v1", "en", "UTILITY", components) }

      expect(error.message).to include("error_subcode=2388026")
      expect(error).to be_template_category_mismatch
    end

    it "does not flag other code 100 errors as a category mismatch" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {type: "OAuthException", code: 100, fbtrace_id: "trace_2"}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      error = capture_error { service.create_message_template(waba_id, business_token, "topic_notification_v1", "en", "UTILITY", components) }

      expect(error).not_to be_template_category_mismatch
    end
  end

  describe "#fetch_message_templates" do
    let(:waba_id) { "waba_123" }
    let(:business_token) { "business_token_123" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{waba_id}/message_templates" }

    it "successfully fetches message templates filtered by name" do
      stub_request(:get, endpoint)
        .with(query: {fields: "name,language,status,category", limit: 500, name: "topic_notification_v1"})
        .to_return(
          status: 200,
          body: {data: [{name: "topic_notification_v1", language: "en", status: "APPROVED", category: "UTILITY"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      templates = service.fetch_message_templates(waba_id, business_token, "topic_notification_v1")

      expect(templates).to eq([{"name" => "topic_notification_v1", "language" => "en", "status" => "APPROVED", "category" => "UTILITY"}])
    end

    it "fetches all message templates when no name is given" do
      stub_request(:get, endpoint)
        .with(query: {fields: "name,language,status,category", limit: 500})
        .to_return(
          status: 200,
          body: {data: []}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      templates = service.fetch_message_templates(waba_id, business_token)

      expect(templates).to eq([])
    end

    it "raises error when fetching templates fails" do
      stub_request(:get, endpoint)
        .with(query: {fields: "name,language,status,category", limit: 500})
        .to_return(
          status: 400,
          body: {error: {message: "Invalid WABA"}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.fetch_message_templates(waba_id, business_token)
      }.to raise_error(WhatsappService::Error, /Fetch message templates failed/)
    end
  end

  describe "#send_template_message" do
    let(:phone_number_id) { "phone_123" }
    let(:business_token) { "business_token_123" }
    let(:to) { "+1234567890" }
    let(:template_name) { "suwali_topic_notification_journalist_v3" }
    let(:endpoint) { "https://graph.facebook.com/v21.0/#{phone_number_id}/messages" }

    it "sends a template message with body parameters and button payloads" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "msg_123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_template_message(phone_number_id, business_token, to, template_name, "en", ["Elections", "A new article is available."], ["see_more", "unsubscribe"])

      expect(response.code).to eq(200)
      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          template = body["template"]
          body["to"] == to &&
            body["type"] == "template" &&
            template["name"] == template_name &&
            template["language"] == {"code" => "en"} &&
            template["components"] == [
              {"type" => "body", "parameters" => [{"type" => "text", "text" => "Elections"}, {"type" => "text", "text" => "A new article is available."}]},
              {"type" => "button", "sub_type" => "quick_reply", "index" => "0", "parameters" => [{"type" => "payload", "payload" => "see_more"}]},
              {"type" => "button", "sub_type" => "quick_reply", "index" => "1", "parameters" => [{"type" => "payload", "payload" => "unsubscribe"}]}
            ]
        }
    end

    it "sends a template message without parameters or buttons" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "msg_123"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.send_template_message(phone_number_id, business_token, to, template_name, "en")

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["template"]["components"] == []
        }
    end

    it "sends a template message to a BSUID using 'recipient' param" do
      bsuid = "US.1349120865530274"
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {messages: [{id: "msg_456"}]}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.send_template_message(phone_number_id, business_token, bsuid, template_name, "en")

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req|
          body = JSON.parse(req.body)
          body["recipient"] == bsuid && !body.key?("to")
        }
    end

    it "raises error when sending the template message fails" do
      stub_request(:post, endpoint)
        .to_return(
          status: 400,
          body: {error: {message: "Template not found"}}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      expect {
        service.send_template_message(phone_number_id, business_token, to, template_name, "en")
      }.to raise_error(WhatsappService::Error, /Send template message failed/)
    end
  end
end
