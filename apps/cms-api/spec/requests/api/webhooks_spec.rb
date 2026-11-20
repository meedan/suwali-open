require "rails_helper"

RSpec.describe "Webhooks API", type: :request do
  context "telegram" do
    let(:messaging_integration_id) { 123 }

    let(:valid_telegram_params) do
      {
        update_id: 123456789,
        message: {
          message_id: 1,
          from: {
            id: 987654321,
            is_bot: false,
            first_name: "John",
            username: "johndoe"
          },
          chat: {
            id: 987654321,
            first_name: "John",
            username: "johndoe",
            type: "private"
          },
          date: 1640995200,
          text: "/start"
        }
      }
    end

    let(:invalid_telegram_params) do
      {
        invalid_field: "test"
      }
    end

    let(:secret_token) { "test_secret_token_123" }

    let(:webhook_service_double) { instance_double(WebhookServices::TelegramService) }

    before do
      allow(WebhookServices::TelegramService).to receive(:new).and_return(webhook_service_double)
    end

    it "processes the webhook successfully" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/telegram/#{messaging_integration_id}",
        params: valid_telegram_params,
        headers: {"X-Telegram-Bot-Api-Secret-Token" => secret_token},
        as: :json

      expect(response).to have_http_status(:ok)
      expect(webhook_service_double).to have_received(:valid?)
      expect(webhook_service_double).to have_received(:process).with(secret_token)
    end

    it "processes the webhook successfully with nil token" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/telegram/#{messaging_integration_id}",
        params: valid_telegram_params,
        as: :json

      expect(response).to have_http_status(:ok)
      expect(webhook_service_double).to have_received(:valid?)
      expect(webhook_service_double).to have_received(:process).with(nil)
    end

    it "returns bad request without processing" do
      allow(webhook_service_double).to receive(:valid?).and_return(false)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/telegram/#{messaging_integration_id}",
        params: invalid_telegram_params,
        headers: {"X-Telegram-Bot-Api-Secret-Token" => secret_token},
        as: :json

      expect(response).to have_http_status(:bad_request)
      expect(webhook_service_double).to have_received(:valid?)
      expect(webhook_service_double).not_to have_received(:process)
    end

    it "returns bad request" do
      allow(webhook_service_double).to receive(:valid?).and_return(false)

      post "/api/webhooks/telegram/#{messaging_integration_id}",
        params: {},
        as: :json

      expect(response).to have_http_status(:bad_request)
      expect(webhook_service_double).to have_received(:valid?)
    end

    it "extracts current_external_user_id correctly from valid payload" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      expect(ActiveRecord::Base.connection).to receive(:execute).with(
        "SET LOCAL audit.current_user_id = '987654321'"
      )

      post "/api/webhooks/telegram/#{messaging_integration_id}",
        params: valid_telegram_params,
        as: :json

      expect(response).to have_http_status(:ok)
    end
  end

  context "whatsapp" do
    let(:whatsapp_app_secret) { "test_app_secret_123" }
    let(:whatsapp_verify_token) { "test_verify_token_456" }
    let(:webhook_service_double) { instance_double(WebhookServices::WhatsappService) }

    let(:valid_whatsapp_params) do
      {
        object: "whatsapp_business_account",
        entry: [{
          changes: [{
            field: "messages",
            value: {
              metadata: {
                phone_number_id: "123456789"
              },
              contacts: [{
                wa_id: "1234567890",
                profile: {
                  name: "Test User"
                }
              }],
              messages: [{
                id: "message_123",
                text: {
                  body: "Hello"
                },
                from: "1234567890"
              }]
            }
          }]
        }]
      }
    end

    let(:verification_params) do
      {
        "hub.mode" => "subscribe",
        "hub.verify_token" => whatsapp_verify_token,
        "hub.challenge" => "challenge_string_123"
      }
    end

    before do
      allow(ENV).to receive(:[]).with("WHATSAPP_APP_SECRET").and_return(whatsapp_app_secret)
      allow(ENV).to receive(:[]).with("WHATSAPP_VERIFY_TOKEN").and_return(whatsapp_verify_token)
      allow(WebhookServices::WhatsappService).to receive(:new).with(whatsapp_app_secret, whatsapp_verify_token).and_return(webhook_service_double)
    end

    it "handles GET request verification" do
      allow(webhook_service_double).to receive(:handle_verification).and_return([200, "challenge_string_123", "text/plain"])

      get "/api/webhooks/whatsapp", params: verification_params

      expect(response).to have_http_status(:ok)
      expect(response.body).to eq("challenge_string_123")
    end

    it "processes valid POST webhook" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/whatsapp", params: valid_whatsapp_params, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "returns bad request for invalid POST webhook" do
      allow(webhook_service_double).to receive(:valid?).and_return(false)

      post "/api/webhooks/whatsapp", params: valid_whatsapp_params, as: :json

      expect(response).to have_http_status(:bad_request)
    end

    it "handles exceptions and logs them" do
      allow(webhook_service_double).to receive(:valid?).and_raise(StandardError, "Test error")
      expect(LogService).to receive(:log).with(:error, "WhatsappWebhook", anything)

      post "/api/webhooks/whatsapp", params: valid_whatsapp_params, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "extracts current_external_user_id correctly from valid payload" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      expect(ActiveRecord::Base.connection).to receive(:execute).with(
        "SET LOCAL audit.current_user_id = '1234567890'"
      )

      post "/api/webhooks/whatsapp", params: valid_whatsapp_params, as: :json

      expect(response).to have_http_status(:ok)
    end

    it "sets no audit user when the sender did not share their phone number (identity id is not numeric)" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)
      params = valid_whatsapp_params
      params[:entry][0][:changes][0][:value][:contacts][0][:wa_id] = "MA.1096160786403574"

      expect(ActiveRecord::Base.connection).not_to receive(:execute)
        .with(a_string_starting_with("SET LOCAL audit.current_user_id"))

      post "/api/webhooks/whatsapp", params: params, as: :json

      expect(response).to have_http_status(:ok)
    end
  end

  context "sms" do
    let(:messaging_integration_id) { 456 }
    let(:webhook_service_double) { instance_double(WebhookServices::SmsService) }

    before do
      allow(WebhookServices::SmsService).to receive(:new).and_return(webhook_service_double)
    end

    it "processes the webhook successfully" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/sms/#{messaging_integration_id}",
        params: {From: "+15557778888", To: "+15550001111", Body: "hello", MessageSid: "SM1"}

      expect(response).to have_http_status(:ok)
      expect(webhook_service_double).to have_received(:process)
    end

    it "returns bad request when the webhook is invalid" do
      allow(webhook_service_double).to receive(:valid?).and_return(false)
      allow(webhook_service_double).to receive(:process)

      post "/api/webhooks/sms/#{messaging_integration_id}", params: {From: "+15557778888"}

      expect(response).to have_http_status(:bad_request)
      expect(webhook_service_double).not_to have_received(:process)
    end

    it "returns ok and logs when processing raises" do
      allow(webhook_service_double).to receive(:valid?).and_raise(StandardError.new("boom"))
      allow(LogService).to receive(:log)

      post "/api/webhooks/sms/#{messaging_integration_id}", params: {From: "+15557778888"}

      expect(response).to have_http_status(:ok)
      expect(LogService).to have_received(:log).with(:error, "SmsWebhook", /boom/)
    end

    it "sets the audit user from the sender number" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      expect(ActiveRecord::Base.connection).to receive(:execute).with(
        "SET LOCAL audit.current_user_id = '+15557778888'"
      )

      post "/api/webhooks/sms/#{messaging_integration_id}",
        params: {From: "+15557778888", To: "+15550001111", Body: "hello"}

      expect(response).to have_http_status(:ok)
    end

    it "strips the rcs: prefix from the audit user so it stays numeric-castable" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      expect(ActiveRecord::Base.connection).to receive(:execute).with(
        "SET LOCAL audit.current_user_id = '+15557779999'"
      )

      post "/api/webhooks/sms/#{messaging_integration_id}",
        params: {From: "rcs:+15557779999", To: "rcs:acme_agent", Body: "hi"}

      expect(response).to have_http_status(:ok)
    end

    it "sets no audit user for an RCS status callback (From is the agent id, not numeric)" do
      allow(webhook_service_double).to receive(:valid?).and_return(true)
      allow(webhook_service_double).to receive(:process)

      expect(ActiveRecord::Base.connection).not_to receive(:execute)
        .with(a_string_starting_with("SET LOCAL audit.current_user_id"))

      post "/api/webhooks/sms/#{messaging_integration_id}",
        params: {From: "rcs:acme_agent", To: "rcs:+15557779999", MessageStatus: "delivered", MessageSid: "MM1"}

      expect(response).to have_http_status(:ok)
    end
  end
end
