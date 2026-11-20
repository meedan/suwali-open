require "rails_helper"

RSpec.describe ConversationInactivityWorker, type: :worker do
  let(:conversation) { create(:conversation, platform: "telegram") }

  before { allow(KnowledgeService).to receive(:preview).and_return("Generated closing.") }

  it "returns when message is not found" do
    expect {
      described_class.new.perform(999999)
    }.not_to change { Message.count }
  end

  it "returns when conversation is not found" do
    message = create(:message, direction: "outgoing", conversation: conversation)
    allow_any_instance_of(Message).to receive(:conversation).and_return(nil)

    expect {
      described_class.new.perform(message.id)
    }.not_to change { Message.count }
  end

  it "returns when there is a newer outgoing message" do
    old_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)
    create(:message, direction: "outgoing", conversation: conversation, created_at: 5.minutes.ago)

    expect {
      described_class.new.perform(old_message.id)
    }.not_to change { Message.where(state: :closed_window).count }
  end

  it "creates closing message when there is no newer outgoing message" do
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    expect {
      described_class.new.perform(triggering_message.id)
    }.to change { Message.where(state: :closed_window).count }.by(1)

    closing_message = Message.where(state: :closed_window).last
    expect(closing_message.direction).to eq("outgoing")
    expect(closing_message.body).to eq("Generated closing.")
    expect(closing_message.conversation).to eq(conversation)
  end

  it "generates the closing message in the conversation language" do
    conversation.update_column(:language, "ar")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    described_class.new.perform(triggering_message.id)

    expect(KnowledgeService).to have_received(:preview).with("conversation_closed", hash_including(default_language: "ar"))
  end

  it "falls back to the static closing message in the conversation language when generation fails" do
    allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything).and_raise(KnowledgeService::Error, "Service unavailable")
    conversation.update_column(:language, "ar")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    described_class.new.perform(triggering_message.id)

    closing_message = Message.where(state: :closed_window).last
    expect(closing_message.body).to eq(I18n.t(:conversation_inactivity_closing, locale: :ar))
  end

  it "generates the closing message in english for an unsupported conversation language" do
    conversation.update_column(:language, "xx")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    described_class.new.perform(triggering_message.id)

    expect(KnowledgeService).to have_received(:preview).with("conversation_closed", hash_including(default_language: "en"))
  end

  it "falls back to the static closing message when the Knowledge Service rejects the request" do
    allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything).and_raise(KnowledgeService::TooLongMessageError, "Unprocessable")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    described_class.new.perform(triggering_message.id)

    closing_message = Message.where(state: :closed_window).last
    expect(closing_message.body).to eq(I18n.t(:conversation_inactivity_closing))
  end

  it "does not send the closing message when the user writes while it is being generated" do
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)
    allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything) do
      create(:message, :incoming, conversation: conversation, body: "Back again")
      "Generated closing."
    end

    expect {
      described_class.new.perform(triggering_message.id)
    }.not_to change { Message.where(state: :closed_window).count }
  end

  it "does not send the closing message when the bot replies while it is being generated" do
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)
    allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything) do
      create(:message, :outgoing, conversation: conversation, body: "A new answer")
      "Generated closing."
    end

    expect {
      described_class.new.perform(triggering_message.id)
    }.not_to change { Message.where(state: :closed_window).count }
  end

  it "falls back to english for unsupported conversation language" do
    allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything).and_raise(KnowledgeService::Error, "Service unavailable")
    conversation.update_column(:language, "xx")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, created_at: 10.minutes.ago)

    expect {
      described_class.new.perform(triggering_message.id)
    }.not_to raise_error

    closing_message = Message.where(state: :closed_window).last
    expect(closing_message.body).to eq(I18n.t(:conversation_inactivity_closing, locale: :en))
  end

  it "appends the window's topics to the closing message body" do
    hub = conversation.hub
    topic = hub.topics.create!(name: "Climate")
    create(:message, :incoming, conversation: conversation).topics << topic
    create(:document, source: create(:source, hub: hub)).topics << topic # supporting document
    triggering_message = create(:message, :outgoing, conversation: conversation)

    described_class.new.perform(triggering_message.id)

    closing_message = Message.where(state: :closed_window).last
    expect(closing_message.body).to include("Generated closing.")
    expect(closing_message.body).to include(I18n.t(:message_closed_window_topics, topics: "Climate"))
  end

  it "creates closing message when there are no messages after the triggering message" do
    triggering_message = create(:message, direction: "outgoing", conversation: conversation)

    expect {
      described_class.new.perform(triggering_message.id)
    }.to change { Message.where(state: :closed_window).count }.by(1)
  end

  it "creates closing message when the current window has both user questions and contributions" do
    create(:message, direction: "incoming", conversation: conversation, body: "What's the capital of France?")
    triggering_message = create(:message, direction: "outgoing", conversation: conversation, body: "Paris")
    create(:message, direction: "outgoing", conversation: conversation, state: :bot_contribution_started)
    create(:message, direction: "outgoing", conversation: conversation, state: :bot_contribution_submitted)

    expect {
      described_class.new.perform(triggering_message.id)
    }.to change { Message.where(state: :closed_window).count }.by(1)
  end

  it "only creates a closing message from the latest real reply when a contribution sits in between two Q&A exchanges" do
    first_reply = create(:message, direction: "outgoing", conversation: conversation, body: "First answer")
    create(:message, direction: "outgoing", conversation: conversation, state: :bot_contribution_started)
    create(:message, direction: "outgoing", conversation: conversation, state: :bot_contribution_submitted)
    second_reply = create(:message, direction: "outgoing", conversation: conversation, body: "Second answer")

    expect {
      described_class.new.perform(first_reply.id)
    }.not_to change { Message.where(state: :closed_window).count }

    expect {
      described_class.new.perform(second_reply.id)
    }.to change { Message.where(state: :closed_window).count }.by(1)
  end
end
