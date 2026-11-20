require "rails_helper"

RSpec.describe MessageSenderServices::BaseService, type: :service do
  it "defines the basic structure of a message sender service" do
    message = build(:message, conversation: build(:conversation, participant: build(:external_user)))
    service = MessageSenderServices::BaseService.new(message)
    expect { service.send_message }.to raise_error(NotImplementedError)
    expect(service.send(:hub)).to be_a(Hub)
    expect(service.send(:conversation)).to be_a(Conversation)
    expect(service.send(:external_user)).to be_a(ExternalUser)
  end

  it "returns body as-is for intermediary messages when format_italic is not overridden" do
    message = build(:message, state: :bot_intermediary_message, body: "Checking sources...", conversation: build(:conversation, participant: build(:external_user)))
    service = MessageSenderServices::BaseService.new(message)
    expect(service.send(:formatted_body)).to eq("Checking sources...")
  end

  it "returns body as-is for regular messages" do
    message = build(:message, state: :bot_message, body: "The answer is 42", conversation: build(:conversation, participant: build(:external_user)))
    service = MessageSenderServices::BaseService.new(message)
    expect(service.send(:formatted_body)).to eq("The answer is 42")
  end
end
