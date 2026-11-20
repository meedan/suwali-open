require "rails_helper"

RSpec.describe WhatsappTemplateCreationWorker, type: :worker do
  let!(:whatsapp_service_double) { instance_double(WhatsappService) }
  let!(:hub) { create(:hub) }
  let!(:integration) do
    create(:whatsapp_messaging_integration, hub: hub, credentials: {
      waba_id: "waba_123",
      business_token: "token_123"
    })
  end
  let(:tones) { Hub::TONES }
  let(:journalist_template_name) { WhatsappMessagingIntegration.topic_notification_template_name("journalist") }

  before do
    allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
  end

  it "creates one template per tone for each supported language" do
    creations = []
    allow(whatsapp_service_double).to receive(:fetch_message_templates).with("waba_123", "token_123").and_return([])
    allow(whatsapp_service_double).to receive(:create_message_template) { |*args| creations << args and true }

    described_class.new.perform(integration.id)

    expect(creations.size).to eq(SUPPORTED_LANGUAGES.size * tones.size)
    expect(creations.map { |args| args[2] }.uniq).to match_array(tones.map { |tone| WhatsappMessagingIntegration.topic_notification_template_name(tone) })
    # Languages are mapped to WhatsApp template language codes
    expect(creations.map { |args| args[3] }.uniq).to match_array(SUPPORTED_LANGUAGES.keys.map { |language| WhatsappMessagingIntegration.template_language_code(language) })
    creations.each do |waba_id, business_token, _name, _language, category, components|
      expect(waba_id).to eq("waba_123")
      expect(business_token).to eq("token_123")
      expect(category).to eq("UTILITY")
      expect(components.first[:type]).to eq("BODY")
      expect(components.first[:text]).to include("{{1}}")
      expect(components.last[:buttons].map { |button| button[:type] }).to eq(["QUICK_REPLY", "QUICK_REPLY"])
    end
  end

  it "skips templates that already exist for the language" do
    allow(whatsapp_service_double).to receive(:fetch_message_templates)
      .and_return([{"name" => journalist_template_name, "language" => "en", "status" => "APPROVED", "category" => "UTILITY"}])
    allow(whatsapp_service_double).to receive(:create_message_template).and_return(true)

    described_class.new.perform(integration.id)

    expect(whatsapp_service_double).to have_received(:create_message_template).exactly(SUPPORTED_LANGUAGES.size * tones.size - 1).times
    expect(whatsapp_service_double).not_to have_received(:create_message_template)
      .with("waba_123", "token_123", journalist_template_name, "en", "UTILITY", anything)
  end

  it "creates a template when it only exists for another language" do
    allow(whatsapp_service_double).to receive(:fetch_message_templates)
      .and_return(tones.map { |tone| {"name" => WhatsappMessagingIntegration.topic_notification_template_name(tone), "language" => "pt_BR", "status" => "APPROVED", "category" => "UTILITY"} })
    allow(whatsapp_service_double).to receive(:create_message_template).and_return(true)

    described_class.new.perform(integration.id)

    expect(whatsapp_service_double).to have_received(:create_message_template).exactly((SUPPORTED_LANGUAGES.size - 1) * tones.size).times
    expect(whatsapp_service_double).not_to have_received(:create_message_template)
      .with("waba_123", "token_123", journalist_template_name, "pt_BR", "UTILITY", anything)
  end

  it "does nothing when the integration does not exist" do
    described_class.new.perform(0)

    expect(WhatsappService).not_to have_received(:new)
  end

  it "logs an error and does nothing when credentials are missing" do
    integration.credentials = {}
    integration.save!

    expect(LogService).to receive(:log).with(:error, "WhatsappTemplateCreationWorker", /Missing waba_id or business_token/)

    described_class.new.perform(integration.id)

    expect(WhatsappService).not_to have_received(:new)
  end

  def stub_category_mismatch(name, *languages)
    mismatch = WhatsappService::Error.new("mismatch", 100, WhatsappService::TEMPLATE_CATEGORY_MISMATCH_SUBCODE)
    allow(whatsapp_service_double).to receive(:fetch_message_templates).and_return([])
    allow(whatsapp_service_double).to receive(:create_message_template).and_return(true)
    languages.each do |language|
      allow(whatsapp_service_double).to receive(:create_message_template)
        .with("waba_123", "token_123", name, language, "UTILITY", anything)
        .and_raise(mismatch)
    end
  end

  it "attempts every template after Meta rejects some for a category mismatch" do
    advocate_name = WhatsappMessagingIntegration.topic_notification_template_name("advocate")
    stub_category_mismatch(advocate_name, "fr", "hi")
    allow(LogService).to receive(:log)

    described_class.new.perform(integration.id)

    expect(whatsapp_service_double).to have_received(:create_message_template).exactly(SUPPORTED_LANGUAGES.size * tones.size).times
  end

  it "warns about each category mismatch without reporting to Sentry" do
    advocate_name = WhatsappMessagingIntegration.topic_notification_template_name("advocate")
    stub_category_mismatch(advocate_name, "fr", "hi")
    allow(LogService).to receive(:log)

    described_class.new.perform(integration.id)

    expect(LogService).to have_received(:log)
      .with(:warn, "WhatsappTemplateCreationWorker", /Template category mismatch.*Integration ID: #{integration.id}, Template: #{advocate_name}\/fr/)
    expect(LogService).to have_received(:log)
      .with(:warn, "WhatsappTemplateCreationWorker", /Template category mismatch.*Integration ID: #{integration.id}, Template: #{advocate_name}\/hi/)
    expect(LogService).not_to have_received(:log).with(:error, any_args)
  end

  it "re-raises non-mismatch errors from template creation" do
    allow(whatsapp_service_double).to receive(:fetch_message_templates).and_return([])
    allow(whatsapp_service_double).to receive(:create_message_template).and_raise(WhatsappService::Error.new("API error", 100, 1))

    expect {
      described_class.new.perform(integration.id)
    }.to raise_error(WhatsappService::Error)
  end

  it "lets fetch errors bubble up so Sidekiq can retry" do
    allow(whatsapp_service_double).to receive(:fetch_message_templates).and_raise(WhatsappService::Error.new("API error"))

    expect {
      described_class.new.perform(integration.id)
    }.to raise_error(WhatsappService::Error)
  end
end
