require "rails_helper"

RSpec.describe EmbedMessageWorker, type: :worker do
  let(:user_message) { create(:message, direction: "incoming", state: "user_message") }
  let(:non_user_message) { create(:message, direction: "incoming", state: "bot_message") }
  let(:embedding_vector) { Array.new(1024) { rand } }

  describe "#perform" do
    it "calls KnowledgeService.embed and updates message when message is a user message without embedding" do
      expect(KnowledgeService).to receive(:embed).with(user_message.body).and_return(embedding_vector)
      expect(LogService).to receive(:log).with(:info, "EmbedMessageWorker", /Generating embedding for message #{user_message.id}/)

      described_class.new.perform(user_message.id)

      user_message.reload
      expect(user_message.embedding).to be_present
      expect(user_message.embedding).to be_an(Array)
      expect(user_message.embedding.length).to eq(1024)
      # Check first value is approximately equal (accounting for float precision loss in DB)
      expect(user_message.embedding.first).to be_within(0.0001).of(embedding_vector.first)
    end

    it "doesn't call KnowledgeService.embed when message is not a user message" do
      expect(KnowledgeService).not_to receive(:embed)

      described_class.new.perform(non_user_message.id)
    end

    it "doesn't call KnowledgeService.embed when embedding already exists (idempotency)" do
      user_message.update_columns(embedding: embedding_vector)
      expect(KnowledgeService).not_to receive(:embed)

      described_class.new.perform(user_message.id)
    end

    it "doesn't call KnowledgeService.embed when message body is blank" do
      user_message.update_columns(body: "")
      expect(KnowledgeService).not_to receive(:embed)

      described_class.new.perform(user_message.id)
    end

    it "handles RecordNotFound gracefully and logs warning" do
      expect(LogService).to receive(:log).with(:warn, "EmbedMessageWorker", /Message 99999 not found when generating embedding/)

      expect {
        described_class.new.perform(99999)
      }.not_to raise_error
    end

    it "logs a warning and skips clustering when the message body is too long" do
      expect(KnowledgeService).to receive(:embed).with(user_message.body).and_raise(KnowledgeService::TooLongMessageError)
      expect(LogService).to receive(:log).with(:info, "EmbedMessageWorker", /Generating embedding for message #{user_message.id}/)
      expect(LogService).to receive(:log).with(:warn, "EmbedMessageWorker", /Message #{user_message.id} body too long/)
      expect(MessageClusterAssigner).not_to receive(:new)

      expect {
        described_class.new.perform(user_message.id)
      }.not_to raise_error

      expect(user_message.reload.embedding).to be_nil
    end

    it "logs error and re-raises exception when embedding fails" do
      allow_any_instance_of(Message).to receive(:get_and_store_embedding).and_raise(StandardError.new("Embedding service unavailable"))
      expect(LogService).to receive(:log).with(:info, "EmbedMessageWorker", /Generating embedding for message #{user_message.id}/)
      expect(LogService).to receive(:log).with(:error, "EmbedMessageWorker", /Error generating embedding for message #{user_message.id}, will retry: StandardError - Embedding service unavailable/)

      expect {
        described_class.new.perform(user_message.id)
      }.to raise_error(StandardError, "Embedding service unavailable")
    end

    it "logs error and re-raises exception when clustering fails" do
      allow_any_instance_of(Message).to receive(:get_and_store_embedding)
      allow_any_instance_of(MessageClusterAssigner).to receive(:call).and_raise(StandardError.new("Clustering error"))
      expect(LogService).to receive(:log).with(:info, "EmbedMessageWorker", /Generating embedding for message #{user_message.id}/)
      expect(LogService).to receive(:log).with(:error, "EmbedMessageWorker", /Clustering failed for #{user_message.id}: StandardError - Clustering error/)
      expect(LogService).to receive(:log).with(:error, "EmbedMessageWorker", /Error generating embedding for message #{user_message.id}, will retry: StandardError - Clustering error/)

      expect {
        described_class.new.perform(user_message.id)
      }.to raise_error(StandardError, "Clustering error")
    end
  end

  describe "sidekiq configuration" do
    it "uses the embeddings queue" do
      expect(described_class.sidekiq_options_hash["queue"]).to eq(:embeddings)
    end

    it "has retry configured" do
      expect(described_class.sidekiq_options_hash["retry"]).to eq(3)
    end
  end

  describe "sidekiq_retries_exhausted callback" do
    it "logs when retries are exhausted" do
      msg = {
        "args" => [123],
        "jid" => "abc123"
      }

      expect(LogService).to receive(:log).with(:error, "EmbedMessageWorker", /Retries exhausted after 3 attempts - Message ID: 123, Job ID: abc123/)

      described_class.sidekiq_retries_exhausted_block.call(msg, StandardError.new("Error"))
    end
  end
end
