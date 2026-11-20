require "rails_helper"

RSpec.describe WelcomeMessageWorker, type: :worker do
  let(:hub) { create(:hub, bot_attributes: {"default_language" => "en", "supported_languages" => ["en", "es"]}) }
  let(:conversation) { create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email), platform: "internal") }
  let(:message) { create(:message, :incoming, conversation: conversation, body: "hola, una pregunta") }

  before do
    allow(WelcomeMessageWorker).to receive(:perform_async)
    allow(KnowledgeService).to receive(:preview).with("first_message", anything) { |_, personalization| "Welcome in #{personalization[:default_language]}." }
  end

  it "welcomes the user in the detected language, then starts the chat" do
    allow(KnowledgeService).to receive(:detect_language)
      .with("hola, una pregunta", "en", ["en", "es"]).and_return("es")
    expect(KnowledgeServiceWorker).to receive(:perform_async).with("chat", message.id) do
      expect(conversation.messages.where(state: :bot_welcome_message)).to exist
    end

    described_class.new.perform(message.id)

    expect(conversation.reload.language).to eq("es")
    welcome = conversation.messages.find_by(state: :bot_welcome_message)
    expect(welcome.body).to include("Welcome in es.")
    expect(welcome.body).to include(I18n.t(:first_message_ai_disclaimer, locale: :es))
  end

  it "falls back to the conversation language when detection fails" do
    allow(KnowledgeService).to receive(:detect_language).and_raise(KnowledgeService::Error, "timeout")

    described_class.new.perform(message.id)

    expect(conversation.reload.language).to eq("en")
    expect(conversation.messages.find_by(state: :bot_welcome_message).body).to include("Welcome in en.")
  end

  it "does nothing when the message was already welcomed" do
    message
    create(:message, :outgoing, conversation: conversation, state: :bot_welcome_message, body: "Welcome.")
    expect(KnowledgeService).not_to receive(:detect_language)
    expect(KnowledgeServiceWorker).not_to receive(:perform_async)

    described_class.new.perform(message.id)
  end

  it "skips detection when the hub supports a single language" do
    hub.update!(bot_attributes: {"default_language" => "en", "supported_languages" => ["en"]})
    expect(KnowledgeService).not_to receive(:detect_language)

    described_class.new.perform(message.id)

    expect(conversation.messages.find_by(state: :bot_welcome_message).body).to include("Welcome in en.")
  end

  it "acknowledges the message instead when the welcome can't be generated" do
    sms_conversation = create(:conversation, hub: hub, platform: "sms", participant: create(:external_user, platform: "sms", external_id: "uid"))
    sms_message = create(:message, :incoming, conversation: sms_conversation, body: "hello")
    allow(KnowledgeService).to receive(:detect_language).and_return("en")
    allow(KnowledgeService).to receive(:preview).with("first_message", anything).and_raise(KnowledgeService::Error, "Service unavailable")
    expect(KnowledgeServiceWorker).to receive(:perform_async).with("chat", sms_message.id)

    described_class.new.perform(sms_message.id)

    expect(sms_conversation.messages.where(state: :bot_welcome_message)).to be_empty
    expect(sms_conversation.messages.where(state: :bot_processing).count).to eq(1)
  end

  it "keeps the conversation language when the detected language isn't supported by the app" do
    hub.update!(bot_attributes: {"default_language" => "en"})
    allow(KnowledgeService).to receive(:detect_language).and_return("de")

    described_class.new.perform(message.id)

    expect(conversation.reload.language).to eq("en")
    expect(conversation.messages.find_by(state: :bot_welcome_message).body).to include("Welcome in en.")
  end
end
