require "rails_helper"

RSpec.describe ChatTimeoutWorker, type: :worker do
  let(:incoming_message) { create(:message, :incoming) }

  describe "#perform" do
    it "creates error message when no reply exists" do
      expect {
        described_class.new.perform(incoming_message.id)
      }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)

      error_msg = incoming_message.conversation.messages.outgoing.last
      expect(error_msg.body).to eq(I18n.t(:error_create_chat_response_message))
      expect(error_msg.state).to eq("knowledge_service_error")
      expect(error_msg.reply_to).to eq(incoming_message)
    end

    it "releases the rate limiter" do
      limiter = instance_double(ConversationRateLimiter)
      allow(ConversationRateLimiter).to receive(:new).with(incoming_message.conversation).and_return(limiter)
      expect(limiter).to receive(:release!)

      described_class.new.perform(incoming_message.id)
    end

    it "does nothing when a reply already exists" do
      create(:message, :outgoing, conversation: incoming_message.conversation, reply_to: incoming_message)

      expect {
        described_class.new.perform(incoming_message.id)
      }.not_to change { incoming_message.conversation.messages.count }
    end

    it "does nothing for outgoing messages" do
      outgoing_message = create(:message, :outgoing)

      expect {
        described_class.new.perform(outgoing_message.id)
      }.not_to change { outgoing_message.conversation.messages.count }
    end

    it "does nothing when message does not exist" do
      expect {
        described_class.new.perform(0)
      }.not_to raise_error
    end
  end
end
