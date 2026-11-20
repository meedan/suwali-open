require "rails_helper"

RSpec.describe "Messaging Integrations API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "MSGINT") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "OTHRMSG") }

  let(:valid_attributes_for_telegram) do
    {
      messaging_integration: {
        hub_id: hub.id,
        platform: "telegram",
        telegram_bot_token: "123456789:ABC DEF1234ghIkl zyx57W2v1u123ew11"
      }
    }
  end

  context "when listing messaging integrations" do
    let!(:integration) { create(:internal_messaging_integration, hub: hub) }
    let!(:other_integration) { create(:whatsapp_messaging_integration, hub: hub) }

    it "returns integrations if user has access to hub" do
      get "/api/hubs/#{hub.id}/messaging-integrations", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |d| d["platform"] }).to include("internal", "whatsapp")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/messaging-integrations", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent hub" do
      get "/api/hubs/999999/messaging-integrations", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when creating a new messaging integration" do
    it "creates with valid parameters for telegram" do
      expect_any_instance_of(TelegramMessagingIntegration).to receive(:setup_telegram_webhook!).once
      expect {
        post "/api/messaging-integrations", params: valid_attributes_for_telegram, headers: headers
      }.to change(TelegramMessagingIntegration, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["platform"]).to eq("telegram")
      expect(json["active"]).to eq(true)
      expect(json["hub_id"]).to eq(hub.id)
      expect(json["credentials"]).to be_nil
      expect(TelegramMessagingIntegration.find(json["id"]).credentials["bot_token"]).to eq("123456789:ABCDEF1234ghIklzyx57W2v1u123ew11")
    end

    it "returns validation errors for invalid integration" do
      create(:whatsapp_messaging_integration, hub_id: hub.id)
      invalid_attributes = {
        messaging_integration: {
          hub_id: hub.id,
          platform: "whatsapp"
        }
      }
      post "/api/messaging-integrations", params: invalid_attributes, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      forbidden_attributes = {
        messaging_integration: {
          hub_id: other_hub.id,
          platform: "whatsapp"
        }
      }
      post "/api/messaging-integrations", params: forbidden_attributes, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns forbidden if user is not authenticated" do
      post "/api/messaging-integrations", params: valid_attributes_for_telegram
      expect(response).to have_http_status(:unauthorized)
    end

    context "for sms" do
      let(:provider) { instance_double(SmsProviders::Twilio) }
      let(:valid_attributes_for_sms) do
        {messaging_integration: {hub_id: hub.id, platform: "sms", sms_country: "US"}}
      end

      before do
        allow(SmsProviders).to receive(:for).and_return(provider)
        hub.update!(custom_limits: {"sms" => true})
      end

      it "provisions a number and creates the integration" do
        allow(provider).to receive(:provision_number).with(country: "US", type: "tollfree", friendly_name: hub.name.first(64), region: nil, area_code: nil).and_return("+18885550000")
        allow(provider).to receive(:configure_inbound_webhook)
        allow(provider).to receive(:registration_status).and_return("unregistered")

        expect {
          post "/api/messaging-integrations", params: valid_attributes_for_sms, headers: headers
        }.to change(SmsMessagingIntegration, :count).by(1)

        expect(response).to have_http_status(:created)
        json = JSON.parse(response.body)
        expect(json["platform"]).to eq("sms")
        expect(json["phone_number"]).to eq("+18885550000")
        expect(json["country"]).to eq("US")
        expect(json["registration_status"]).to eq("unregistered")
        expect(json["credentials"]).to be_nil
      end

      it "provisions a local number under the 10DLC regime when requested" do
        allow(provider).to receive(:provision_number).with(country: "US", type: "local", friendly_name: hub.name.first(64), region: "CA", area_code: nil).and_return("+15551230000")
        allow(provider).to receive(:configure_inbound_webhook)
        allow(provider).to receive(:registration_status).and_return("unregistered")

        post "/api/messaging-integrations", params: {messaging_integration: {hub_id: hub.id, platform: "sms", sms_country: "US", sms_number_type: "local", sms_state: "CA"}}, headers: headers

        expect(response).to have_http_status(:created)
        json = JSON.parse(response.body)
        expect(json["phone_number"]).to eq("+15551230000")
        expect(json["number_type"]).to eq("local")
        expect(json["registration_type"]).to eq("us_10dlc")
      end

      it "rejects an unsupported number type and provisions nothing" do
        allow(provider).to receive(:provision_number)

        expect {
          post "/api/messaging-integrations", params: {messaging_integration: {hub_id: hub.id, platform: "sms", sms_country: "US", sms_number_type: "mobile"}}, headers: headers
        }.not_to change(SmsMessagingIntegration, :count)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_sms_unsupported_number_type))
        expect(provider).not_to have_received(:provision_number)
      end

      it "rolls back and returns an error when provisioning fails" do
        allow(provider).to receive(:provision_number).and_raise(SmsProviders::Base::Error.new("no numbers"))
        allow(LogService).to receive(:log)

        expect {
          post "/api/messaging-integrations", params: valid_attributes_for_sms, headers: headers
        }.not_to change(SmsMessagingIntegration, :count)

        expect(response).to have_http_status(:unprocessable_content)
        json = JSON.parse(response.body)
        expect(json["errors"]).to include(I18n.t(:error_sms_provisioning_failed))
      end

      it "returns an error and provisions nothing when SMS is not enabled for the hub" do
        hub.update!(custom_limits: {})
        allow(provider).to receive(:provision_number)

        expect {
          post "/api/messaging-integrations", params: valid_attributes_for_sms, headers: headers
        }.not_to change(SmsMessagingIntegration, :count)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_plan_restriction_sms_not_available))
        expect(provider).not_to have_received(:provision_number)
      end

      it "rejects an unsupported country and provisions nothing" do
        allow(provider).to receive(:provision_number)

        expect {
          post "/api/messaging-integrations", params: {messaging_integration: {hub_id: hub.id, platform: "sms", sms_country: "GB"}}, headers: headers
        }.not_to change(SmsMessagingIntegration, :count)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_sms_unsupported_country))
        expect(provider).not_to have_received(:provision_number)
      end
    end

    context "for signal" do
      let(:signal_service) { instance_double(SignalService) }
      let(:link_uri) { "sgnl://linkdevice?uuid=abc&pub_key=def" }

      before { allow(SignalService).to receive(:new).and_return(signal_service) }

      it "creates a pending integration with the link to show as a QR code" do
        allow(signal_service).to receive(:start_link).and_return(link_uri)

        expect {
          post "/api/messaging-integrations", params: {messaging_integration: {hub_id: hub.id, platform: "signal"}}, headers: headers
        }.to change(SignalMessagingIntegration, :count).by(1)
          .and change(SignalLinkWorker.jobs, :size).by(1)

        expect(response).to have_http_status(:created)
        json = JSON.parse(response.body)
        expect(json).to include("platform" => "signal", "active" => false, "signal_link" => {"uri" => link_uri, "status" => "pending"})
        expect(json["credentials"]).to be_nil
      end

      it "creates nothing when signal-cli can't start linking" do
        allow(signal_service).to receive(:start_link).and_raise(SignalService::Error, "connection refused")

        expect {
          post "/api/messaging-integrations", params: {messaging_integration: {hub_id: hub.id, platform: "signal"}}, headers: headers
        }.not_to change(SignalMessagingIntegration, :count)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_signal_link_failed))
      end
    end
  end

  context "when deleting a messaging integration" do
    it "deletes if user has access to hub" do
      integration = create(:whatsapp_messaging_integration, hub: hub)
      expect {
        delete "/api/messaging-integrations/#{integration.id}", headers: headers
      }.to change(MessagingIntegration, :count).by(-1)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to eq(I18n.t(:message_deleted))
      expect(MessagingIntegration.find_by_id(integration.id)).to be(nil)
    end

    it "returns not found if user doesn't have access to hub" do
      integration = create(:messaging_integration, hub: other_hub)
      expect {
        delete "/api/messaging-integrations/#{integration.id}", headers: headers
      }.to_not change(MessagingIntegration, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent integration" do
      delete "/api/messaging-integrations/999999", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns forbidden if user is not authenticated" do
      integration = create(:messaging_integration, hub: hub)
      delete "/api/messaging-integrations/#{integration.id}"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  context "when handling whatsapp callback" do
    let!(:whatsapp_integration) { create(:whatsapp_messaging_integration, hub: hub) }
    let(:esu_state) { "test_state_123" }
    let(:valid_callback_params) do
      {
        integration_id: whatsapp_integration.id,
        state: esu_state,
        code: "auth_code_123",
        waba_id: "waba_123456",
        phone_number_id: "phone_123456",
        business_id: "business_123456"
      }
    end
    let(:whatsapp_service) { instance_double(WhatsappService) }
    let(:business_token) { "business_token_123" }
    let(:phone_number) { "+1234567890" }

    before do
      whatsapp_integration.set_credential(:esu_state, esu_state)
      whatsapp_integration.save!

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service)
      allow(whatsapp_service).to receive(:exchange_code_for_business_token).with("auth_code_123").and_return(business_token)
      allow(whatsapp_service).to receive(:subscribe_waba).with("waba_123456", business_token)
      allow(whatsapp_service).to receive(:share_credit_line).with("waba_123456", business_token)
      allow(whatsapp_service).to receive(:fetch_phone_number).with("phone_123456", business_token).and_return(phone_number)
      allow(whatsapp_service).to receive(:register_phone_number)
      allow(whatsapp_service).to receive(:fetch_phone_number_status).and_return({quality_rating: "GREEN", status: "CONNECTED", account_mode: "LIVE"})
      allow(whatsapp_service).to receive(:fetch_business_verification_status).and_return("VERIFIED")
      allow(whatsapp_service).to receive(:fetch_message_templates).and_return([])
      allow(SecureRandom).to receive(:random_number).with(1_000_000).and_return(123456)
    end

    it "successfully processes whatsapp callback with valid parameters" do
      post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["active"]).to eq(true)

      whatsapp_integration.reload
      expect(whatsapp_integration.get_credential(:business_token)).to eq(business_token)
      expect(whatsapp_integration.get_credential(:pin)).to eq("123456")
      expect(whatsapp_integration.get_credential(:waba_id)).to eq("waba_123456")
      expect(whatsapp_integration.get_credential(:phone_number_id)).to eq("phone_123456")
      expect(whatsapp_integration.get_credential(:phone_number)).to eq(phone_number)
      expect(whatsapp_integration.get_credential(:business_id)).to eq("business_123456")
      expect(whatsapp_integration.active).to eq(true)
    end

    it "enqueues template creation when signup completes" do
      expect {
        post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers
      }.to change(WhatsappTemplateCreationWorker.jobs, :size).by(1)

      expect(WhatsappTemplateCreationWorker.jobs.last["args"]).to eq([whatsapp_integration.id])
    end

    it "does not enqueue template creation when signup fails" do
      allow(whatsapp_service).to receive(:register_phone_number).and_raise(StandardError, "Registration failed")
      allow(LogService).to receive(:log)

      expect {
        post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers
      }.not_to change(WhatsappTemplateCreationWorker.jobs, :size)
    end

    it "makes correct API calls to WhatsappService" do
      post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers

      expect(whatsapp_service).to have_received(:exchange_code_for_business_token).with("auth_code_123")
      expect(whatsapp_service).to have_received(:subscribe_waba).with("waba_123456", business_token)
      expect(whatsapp_service).to have_received(:share_credit_line).with("waba_123456", business_token)
      expect(whatsapp_service).to have_received(:fetch_phone_number).with("phone_123456", business_token)
      expect(whatsapp_service).to have_received(:register_phone_number).with("phone_123456", "123456", business_token)
    end

    it "returns not found if user doesn't have access to hub" do
      other_integration = create(:whatsapp_messaging_integration, hub: other_hub)
      other_integration.set_credential(:esu_state, esu_state)
      other_integration.save!

      callback_params = valid_callback_params.merge(integration_id: other_integration.id)

      post "/api/messaging-integrations/whatsapp-callback", params: callback_params, headers: headers

      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns unprocessable_content if state is blank" do
      callback_params = valid_callback_params.merge(state: "")

      post "/api/messaging-integrations/whatsapp-callback", params: callback_params, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_whatsapp_invalid_state))
    end

    it "returns unprocessable_content if state doesn't match stored state" do
      callback_params = valid_callback_params.merge(state: "wrong_state")

      post "/api/messaging-integrations/whatsapp-callback", params: callback_params, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_whatsapp_invalid_state))
    end

    it "handles phone number registration failures" do
      allow(whatsapp_service).to receive(:register_phone_number).and_raise(StandardError, "Registration failed")
      expect(LogService).to receive(:log).with(:error, "whatsapp_callback", anything)

      post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers

      expect(response).to have_http_status(:ok)
      whatsapp_integration.reload
      expect(whatsapp_integration.active).to eq(false)
    end

    it "returns unauthorized if user is not authenticated" do
      post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params
      expect(response).to have_http_status(:unauthorized)
    end

    it "returns not found for non-existent integration" do
      callback_params = valid_callback_params.merge(integration_id: 999999)

      post "/api/messaging-integrations/whatsapp-callback", params: callback_params, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "pads PIN correctly with leading zeros" do
      allow(SecureRandom).to receive(:random_number).with(1_000_000).and_return(123)

      post "/api/messaging-integrations/whatsapp-callback", params: valid_callback_params, headers: headers

      whatsapp_integration.reload
      expect(whatsapp_integration.get_credential(:pin)).to eq("000123")
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Messaging Integrations API" do
  path "/api/messaging-integrations" do
    post "Creates a messaging integration" do
      tags "MessagingIntegration"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :messaging_integration, in: :body, schema: {
        type: :object,
        properties: {
          messaging_integration: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              platform: {type: :string, example: "telegram", enum: ["telegram", "whatsapp", "sms", "signal"]},
              telegram_bot_token: {type: :string, example: "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11", description: "Required only for telegram platform"},
              sms_country: {type: :string, example: "US", description: "Required only for sms platform (ISO 3166-1 alpha-2 country code); a number is provisioned for it"},
              sms_number_type: {type: :string, example: "tollfree", enum: ["tollfree", "local"], description: "Optional for sms platform; number type to provision (defaults to tollfree). Available types per country come from /api/about"},
              sms_state: {type: :string, example: "CA", description: "Optional for sms platform with local number type; two-letter state code to provision the number in"},
              sms_area_code: {type: :string, example: "718", description: "Optional for sms platform with local number type; three-digit area code to provision the number in"}
            },
            required: ["hub_id", "platform"]
          }
        },
        required: ["messaging_integration"]
      }

      response "201", "Messaging integration created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:messaging_integration) { {"messaging_integration" => {hub_id: hub.id, platform: "whatsapp"}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:messaging_integration) { {"messaging_integration" => {platform: "telegram"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create messaging integration" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:messaging_integration) { {"messaging_integration" => {hub_id: hub.id, platform: "telegram", telegram_bot_token: "123456789:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/messaging-integrations/{id}" do
    delete "Deletes a messaging integration" do
      tags "MessagingIntegration"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Messaging Integration ID"

      response "200", "Messaging integration deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_integration) { create(:messaging_integration, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_integration.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to delete messaging integration" do
        let!(:user) { create(:user) }
        let!(:existing_integration) { create(:messaging_integration) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_integration.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Messaging integration not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/messaging-integrations" do
    get "Lists the messaging integrations of a hub" do
      tags "MessagingIntegration"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists messaging integrations of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
