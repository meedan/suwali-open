require "rails_helper"

RSpec.describe MessagingIntegration, type: :model do
  let(:telegram_service_double) { instance_double(TelegramService) }
  let(:successful_response) { double("response", success?: true) }

  it "is valid with valid attributes" do
    integration = build(:messaging_integration)
    expect(integration).to be_valid
  end

  it "configures webhook on Telegram creation" do
    allow(TelegramService).to receive(:new).and_return(telegram_service_double)
    allow(telegram_service_double).to receive(:set_webhook).and_return(successful_response)
    allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))

    integration = create(:telegram_messaging_integration, credentials: {foo: "bar"})
    expect(integration.get_credential(:webhook_secret)).not_to be_nil
    expect(integration.get_credential(:foo)).to eq("bar")
  end

  it "returns only phone number for WhatsApp integration when present" do
    integration = build(:whatsapp_messaging_integration, credentials: {phone_number: "+1 123 456 7890"})
    expect(integration.as_json["credentials"]).to be_nil
    expect(integration.as_json[:phone_number]).to eq("+1 123 456 7890")
  end

  describe "WhatsApp phone number status" do
    let(:whatsapp_service_double) { instance_double(WhatsappService) }
    let(:status_response) do
      {
        quality_rating: "GREEN",
        status: "CONNECTED",
        account_mode: "LIVE"
      }
    end

    it "fetches and caches phone number status" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status)
        .with("phone_123", "token_123")
        .and_return(status_response)

      status = integration.phone_number_status
      expect(status).to eq(status_response)

      # Verify it was called once (caching works)
      expect(whatsapp_service_double).to have_received(:fetch_phone_number_status).once
    end

    it "returns nil when phone_number_id is missing" do
      integration = build(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          business_token: "token_123"
        })

      expect(integration.phone_number_status).to be_nil
    end

    it "returns nil when business_token is missing" do
      integration = build(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123"
        })

      expect(integration.phone_number_status).to be_nil
    end

    it "returns nil when WhatsappService raises error" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status)
        .and_raise(WhatsappService::Error.new("API error"))
      allow(Rails.logger).to receive(:error)

      status = integration.phone_number_status
      expect(status).to be_nil
      expect(Rails.logger).to have_received(:error).with(/Failed to fetch WhatsApp status/)
    end

    it "includes phone_number_status in as_json when phone_number is present" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status)
        .with("phone_123", "token_123")
        .and_return(status_response)

      json = integration.as_json
      expect(json[:phone_number]).to eq("+1 123 456 7890")
      expect(json[:phone_number_status]).to eq(status_response)
    end

    it "does not include phone_number_status when phone_number is blank" do
      integration = build(:whatsapp_messaging_integration, credentials: {})

      json = integration.as_json
      expect(json[:phone_number_status]).to be_nil
      expect(json[:whatsapp_signup]).not_to be_nil
    end

    it "uses Rails.cache with correct key and expiration" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123"
        })

      cache_key = "whatsapp_status/#{integration.id}/phone_123"

      expect(Rails.cache).to receive(:fetch).with(cache_key, expires_in: 5.minutes).and_call_original

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status)
        .with("phone_123", "token_123")
        .and_return(status_response)

      status = integration.phone_number_status
      expect(status).to eq(status_response)
    end
  end

  describe "WhatsApp business verification status" do
    let(:whatsapp_service_double) { instance_double(WhatsappService) }

    it "fetches and caches business verification status" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_business_verification_status)
        .with("waba_123", "token_123")
        .and_return("VERIFIED")

      expect(integration.business_verification_status).to eq("VERIFIED")

      # Verify it was called once (caching works)
      expect(whatsapp_service_double).to have_received(:fetch_business_verification_status).once
    end

    it "returns nil when waba_id is missing" do
      integration = build(:whatsapp_messaging_integration, credentials: {business_token: "token_123"})

      expect(integration.business_verification_status).to be_nil
    end

    it "returns nil when business_token is missing" do
      integration = build(:whatsapp_messaging_integration, credentials: {waba_id: "waba_123"})

      expect(integration.business_verification_status).to be_nil
    end

    it "returns nil when WhatsappService raises error" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_business_verification_status)
        .and_raise(WhatsappService::Error.new("API error"))
      allow(LogService).to receive(:log)

      expect(integration.business_verification_status).to be_nil
      expect(LogService).to have_received(:log).with(:error, "WhatsappMessagingIntegration", /Failed to fetch WhatsApp business verification status/)
    end

    it "includes business_verification_status in as_json when phone_number is present" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123",
          waba_id: "waba_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status).and_return({})
      allow(whatsapp_service_double).to receive(:fetch_message_templates).and_return([])
      allow(whatsapp_service_double).to receive(:fetch_business_verification_status)
        .with("waba_123", "token_123")
        .and_return("PENDING")

      json = integration.as_json
      expect(json[:business_verification_status]).to eq("PENDING")
    end
  end

  describe "WhatsApp template status" do
    let(:whatsapp_service_double) { instance_double(WhatsappService) }
    let(:journalist_template_name) { WhatsappMessagingIntegration.topic_notification_template_name("journalist") }
    let(:templates_response) do
      Hub::TONES.map do |tone|
        {"name" => WhatsappMessagingIntegration.topic_notification_template_name(tone), "language" => "en", "status" => "APPROVED", "category" => "UTILITY"}
      end
    end

    it "returns one entry per supported language and tone" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_message_templates)
        .with("waba_123", "token_123")
        .and_return(templates_response)

      statuses = integration.template_statuses
      expect(statuses.size).to eq(SUPPORTED_LANGUAGES.size * Hub::TONES.size)
      expect(statuses.first).to eq({"name" => journalist_template_name, "language" => "en", "tone" => "journalist", "status" => "APPROVED", "category" => "UTILITY"})
    end

    it "returns a nil status for templates that do not exist yet" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_message_templates)
        .and_return(templates_response)

      statuses = integration.template_statuses
      arabic_statuses = statuses.select { |status| status["language"] == "ar" }
      expect(arabic_statuses.size).to eq(Hub::TONES.size)
      expect(arabic_statuses.map { |status| status["status"] }.uniq).to eq([nil])
    end

    it "returns nil when waba_id is missing" do
      integration = build(:whatsapp_messaging_integration, credentials: {business_token: "token_123"})

      expect(integration.template_statuses).to be_nil
    end

    it "returns nil when business_token is missing" do
      integration = build(:whatsapp_messaging_integration, credentials: {waba_id: "waba_123"})

      expect(integration.template_statuses).to be_nil
    end

    it "returns nil when WhatsappService raises error" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_message_templates)
        .and_raise(WhatsappService::Error.new("API error"))
      allow(LogService).to receive(:log)

      expect(integration.template_statuses).to be_nil
      expect(LogService).to have_received(:log).with(:error, "WhatsappMessagingIntegration", /Failed to fetch WhatsApp template status/)
    end

    it "includes template_statuses in as_json when phone_number is present" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          phone_number: "+1 123 456 7890",
          phone_number_id: "phone_123",
          business_token: "token_123",
          waba_id: "waba_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_phone_number_status).and_return({})
      allow(whatsapp_service_double).to receive(:fetch_business_verification_status).and_return("VERIFIED")
      allow(whatsapp_service_double).to receive(:fetch_message_templates).and_return(templates_response)

      json = integration.as_json
      expect(json[:template_statuses].size).to eq(SUPPORTED_LANGUAGES.size * Hub::TONES.size)
      expect(json[:template_statuses].first).to eq({"name" => journalist_template_name, "language" => "en", "tone" => "journalist", "status" => "APPROVED", "category" => "UTILITY"})
    end

    it "matches templates using the WhatsApp template language code" do
      integration = create(:whatsapp_messaging_integration,
        credentials: {
          waba_id: "waba_123",
          business_token: "token_123"
        })

      allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
      allow(whatsapp_service_double).to receive(:fetch_message_templates)
        .and_return([{"name" => journalist_template_name, "language" => "pt_BR", "status" => "PENDING", "category" => "UTILITY"}])

      statuses = integration.template_statuses
      portuguese_status = statuses.find { |status| status["language"] == "pt" && status["tone"] == "journalist" }
      expect(portuguese_status["status"]).to eq("PENDING")
    end
  end

  describe "plan restrictions" do
    it "allows creating messaging integration on premium hub" do
      hub = create(:hub, plan: :enterprise)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).to be_valid
    end

    it "allows creating messaging integration on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).to be_valid
    end

    it "rejects creating messaging integration on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).not_to be_valid
      expect(integration.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end

  describe "plan restrictions - free_unrestricted" do
    it "allows creating messaging integration on free_unrestricted hub" do
      hub = create(:hub, plan: :free_unrestricted)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).to be_valid
    end

    it "rejects creating messaging integration on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).not_to be_valid
      expect(integration.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "allows creating messaging integration on free_unrestricted hub with active trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      integration = build(:internal_messaging_integration, hub: hub)
      expect(integration).to be_valid
    end
  end

  describe "settings accessors" do
    it "reads and writes settings with indifferent access" do
      integration = build(:internal_messaging_integration)

      integration.set_setting(:country, "US")
      expect(integration.get_setting(:country)).to eq("US")
      expect(integration.get_setting("country")).to eq("US")
    end

    it "defaults to an empty hash" do
      integration = build(:internal_messaging_integration)
      expect(integration.get_setting(:missing)).to be_nil
    end

    it "does not expose settings through as_json" do
      integration = build(:internal_messaging_integration)
      integration.set_setting(:country, "US")
      # settings is operational, non-secret metadata; as_json only strips credentials, so settings
      # is available but callers opt into surfacing specific values (see SmsMessagingIntegration).
      expect(integration.settings).to eq({"country" => "US"})
    end
  end
end
