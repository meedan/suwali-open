require "rails_helper"

RSpec.describe DestroyConversationWithMessagesWorker, type: :worker do
  describe "#perform" do
    context "when conversation is marked as deleted" do
      let!(:conversation) { create(:conversation) }
      let!(:message1) { create(:message, :outgoing, conversation: conversation) }
      let!(:message2) { create(:message, :outgoing, conversation: conversation) }

      before do
        conversation.update_column(:deleted_at, Time.current)
      end

      it "destroys the conversation" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(conversation.id)
        }.to change(Conversation, :count).by(-1)

        expect(Conversation.find_by(id: conversation.id)).to be_nil
      end

      it "destroys all messages" do
        allow(LogService).to receive(:log)

        described_class.new.perform(conversation.id)

        expect(Message.find_by(id: message1.id)).to be_nil
        expect(Message.find_by(id: message2.id)).to be_nil
      end

      it "logs the deletion process" do
        expect(LogService).to receive(:log).with(:info, "DestroyConversationWithMessagesWorker", "Starting deletion of conversation #{conversation.id} with 2 messages")
        expect(LogService).to receive(:log).with(:info, "DestroyConversationWithMessagesWorker", "Successfully deleted conversation #{conversation.id}")

        described_class.new.perform(conversation.id)
      end
    end

    context "when conversation is not marked as deleted" do
      let!(:conversation) { create(:conversation) }

      it "does not delete the conversation" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(conversation.id)
        }.not_to change(Conversation, :count)

        expect(Conversation.find_by(id: conversation.id)).not_to be_nil
      end

      it "logs that conversation is not marked as deleted" do
        expect(LogService).to receive(:log).with(:info, "DestroyConversationWithMessagesWorker", "Conversation #{conversation.id} is not marked as deleted, skipping")

        described_class.new.perform(conversation.id)
      end
    end

    context "when conversation does not exist" do
      it "logs that conversation was not found" do
        expect(LogService).to receive(:log).with(:info, "DestroyConversationWithMessagesWorker", "Conversation 999999 not found, may have already been deleted")

        described_class.new.perform(999999)
      end

      it "does not raise an error" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(999999)
        }.not_to raise_error
      end
    end

    context "idempotency" do
      let!(:conversation) { create(:conversation) }

      before do
        conversation.update_column(:deleted_at, Time.current)
      end

      it "running twice does not raise an error" do
        allow(LogService).to receive(:log)

        # First run - deletes the conversation
        described_class.new.perform(conversation.id)

        # Second run - conversation already deleted
        expect {
          described_class.new.perform(conversation.id)
        }.not_to raise_error
      end
    end
  end
end
