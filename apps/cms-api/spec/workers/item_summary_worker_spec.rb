require "rails_helper"

RSpec.describe ItemSummaryWorker, type: :worker do
  let(:message) { create(:message, :outgoing, body: "This is a test message") }
  let(:long_message) { create(:message, :outgoing, body: "A" * 250) }
  let(:notebook) { create(:notebook) }
  let(:notebook_b) { create(:notebook) }

  before do
    allow(KnowledgeService).to receive(:summarize).and_return("AI generated summary")
  end

  describe "#perform with short text" do
    it "copies text to ai_summary without calling KnowledgeService for texts under 200 chars" do
      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform("Message", message.id, notebook.id)
      message.reload

      expect(message.ai_summary).to eq("This is a test message")
    end

    it "triggers notebook summary update even for short texts" do
      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Message", message.id, notebook.id)
    end
  end

  describe "#perform with long text" do
    it "calls KnowledgeService.summarize for texts over 200 chars" do
      expect(KnowledgeService).to receive(:summarize).with("A" * 250, default_language: nil).and_return("AI generated summary")

      described_class.new.perform("Message", long_message.id, notebook.id)
      long_message.reload

      expect(long_message.ai_summary).to eq("AI generated summary")
    end

    it "triggers notebook summary update after generating summary" do
      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Message", long_message.id, notebook.id)
    end

    it "passes the item's hub default_language to KnowledgeService.summarize" do
      hub = create(:hub, bot_attributes: {"name" => "Bot", "description" => "d", "tone" => "friendly", "default_language" => "fr"})
      conversation = create(:conversation, hub: hub)
      message_with_language = create(:message, :outgoing, conversation: conversation, body: "B" * 250)

      expect(KnowledgeService).to receive(:summarize).with("B" * 250, default_language: "fr").and_return("Résumé")

      described_class.new.perform("Message", message_with_language.id, notebook.id)
    end
  end

  describe "#perform with existing ai_summary" do
    it "skips summary generation when ai_summary already exists" do
      message.update_column(:ai_summary, "Existing summary")

      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform("Message", message.id, notebook.id)
      message.reload

      expect(message.ai_summary).to eq("Existing summary")
    end

    it "skips summary generation when a document has a summary written by a user" do
      document = create(:document, content: "A" * 250, summary: "User summary")

      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform("Document", document.id, notebook.id)

      expect(document.reload.ai_summary).to be_blank
    end

    it "still triggers notebook summary update when ai_summary exists" do
      message.update_column(:ai_summary, "Existing summary")

      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Message", message.id, notebook.id)
    end
  end

  describe "#perform with specific notebook_id" do
    it "updates only the specified notebook" do
      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)
      expect(NotebookSummaryWorker).not_to receive(:perform_async).with(notebook_b.id, anything)

      described_class.new.perform("Message", message.id, notebook.id)
    end

    it "updates ai_summary_update_requested_at for the specified notebook" do
      described_class.new.perform("Message", message.id, notebook.id)
      notebook.reload

      expect(notebook.ai_summary_update_requested_at).to be_within(1.second).of(Time.now.utc)
    end
  end

  describe "#perform with a Document that has no content (ingested-only text)" do
    it "summarizes the document's ingested text when sync is complete" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :complete)
      allow(KnowledgeService).to receive(:summarize).and_return("Summary from ingested chunks")

      described_class.new.perform("Document", document.id, notebook.id)
      document.reload

      expect(document.ai_summary).to eq("Summary from ingested chunks")
      expect(KnowledgeService).to have_received(:summarize).with(hub_id: document.hub.id, document_id: Base64.encode64("Document/#{document.id}"), default_language: document.hub.default_language)
    end

    it "leaves ai_summary blank when KnowledgeService returns nothing" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :complete)
      allow(KnowledgeService).to receive(:summarize).and_return("")

      described_class.new.perform("Document", document.id, notebook.id)
      document.reload

      expect(document.ai_summary).to be_blank
    end

    it "still triggers the notebook summary update when KnowledgeService returns nothing" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :complete)
      allow(KnowledgeService).to receive(:summarize).and_return("")

      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Document", document.id, notebook.id)
    end

    it "does not call KnowledgeService when the document has content" do
      document = create(:document, content: "Short content")
      document.update_column(:sync_status, :complete)
      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform("Document", document.id, notebook.id)
      document.reload

      expect(document.ai_summary).to eq("Short content")
    end

    it "leaves ai_summary blank without calling KnowledgeService when sync is pending" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :pending)
      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform("Document", document.id, notebook.id)
      document.reload

      expect(document.ai_summary).to be_blank
    end

    it "still triggers the notebook summary update when sync is pending" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :pending)

      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Document", document.id, notebook.id)
    end
  end

  describe "#perform with a non-Document item that has no text at all" do
    it "does not raise an error" do
      empty_conversation = create(:conversation)

      expect {
        described_class.new.perform("Conversation", empty_conversation.id, notebook.id)
      }.not_to raise_error
    end

    it "still triggers the notebook summary update" do
      empty_conversation = create(:conversation)

      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Conversation", empty_conversation.id, notebook.id)
    end
  end

  describe "#perform when KnowledgeService raises TooLongMessageError" do
    before do
      allow(KnowledgeService).to receive(:summarize).and_raise(KnowledgeService::TooLongMessageError, "text too long")
    end

    it "does not raise and does not retry" do
      expect {
        described_class.new.perform("Message", long_message.id, notebook.id)
      }.not_to raise_error
    end

    it "logs a warning instead of an error" do
      expect(LogService).to receive(:log).with(:warn, "ItemSummaryWorker", /too large to summarize/)

      described_class.new.perform("Message", long_message.id, notebook.id)
    end

    it "still triggers the notebook summary update" do
      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

      described_class.new.perform("Message", long_message.id, notebook.id)
    end

    it "leaves ai_summary blank" do
      described_class.new.perform("Message", long_message.id, notebook.id)
      long_message.reload

      expect(long_message.ai_summary).to be_blank
    end
  end

  describe "#perform with error" do
    it "raises and logs error when item not found" do
      expect(LogService).to receive(:log).with(:error, "ItemSummaryWorker", /Error generating summary/)

      expect {
        described_class.new.perform("Message", 999999, notebook.id)
      }.to raise_error(ActiveRecord::RecordNotFound)
    end
  end

  describe "sidekiq_retries_exhausted callback" do
    it "logs when retries are exhausted" do
      msg = {
        "args" => ["Message", message.id, notebook.id],
        "jid" => "def456"
      }

      expect(LogService).to receive(:log).with(:error, "ItemSummaryWorker", /Retries exhausted after 3 attempts - Item: Message\/#{message.id}, Job ID: def456/)

      described_class.sidekiq_retries_exhausted_block.call(msg, StandardError.new("Error"))
    end
  end
end
