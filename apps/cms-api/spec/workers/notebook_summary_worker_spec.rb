require "rails_helper"

RSpec.describe NotebookSummaryWorker, type: :worker do
  let(:notebook) { create(:notebook) }
  let(:message1) { create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: "Summary 1") }
  let(:message2) { create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: "Summary 2") }
  let(:message3) { create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: "Summary 3") }

  before do
    allow(KnowledgeService).to receive(:summarize).and_return("Notebook AI summary")
    # Prevents NotebookItem's after_commit callbacks from enqueueing real worker runs.
    allow(ItemSummaryWorker).to receive(:perform_async)
    allow(NotebookSummaryWorker).to receive(:perform_async)
  end

  # Marks the notebook as awaiting a summary, as the enqueuing callbacks do; returns the worker's timestamp argument
  def request_summary_update(target = notebook)
    requested_at_timestamp = Time.now.utc.to_i
    target.update_column(:ai_summary_update_requested_at, Time.at(requested_at_timestamp).utc)
    requested_at_timestamp
  end

  describe "#perform with items that have summaries" do
    it "generates notebook summary from item summaries" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 3.days.ago)
      create(:notebook_item, notebook: notebook, item: message2, created_at: 2.days.ago)
      create(:notebook_item, notebook: notebook, item: message3, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_return("Notebook AI summary")

      described_class.new.perform(notebook.id, requested_at_timestamp)
      notebook.reload

      expect(notebook.ai_summary).to eq("Notebook AI summary")
    end

    it "updates ai_summary_updated_at timestamp" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 3.days.ago)

      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)
      notebook.reload

      expect(notebook.ai_summary_updated_at).to be_within(1.second).of(Time.now.utc)
    end

    it "logs success" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 3.days.ago)

      requested_at_timestamp = request_summary_update

      expect(LogService).to receive(:log).with(:info, "NotebookSummaryWorker", /Generated summary for notebook #{notebook.id}/)

      described_class.new.perform(notebook.id, requested_at_timestamp)
    end
  end

  describe "#perform with race condition" do
    it "skips update if a more recent request exists" do
      old_requested_at = 1.hour.ago
      new_requested_at = Time.now.utc
      notebook.update_column(:ai_summary_update_requested_at, new_requested_at)

      expect(KnowledgeService).not_to receive(:summarize)
      expect(LogService).to receive(:log).with(:info, "NotebookSummaryWorker", /Skipping notebook #{notebook.id}/)

      described_class.new.perform(notebook.id, old_requested_at.to_i)
    end

    it "leaves the pending request untouched when a more recent request exists" do
      old_requested_at = 1.hour.ago
      new_requested_at = Time.now.utc
      notebook.update_column(:ai_summary_update_requested_at, new_requested_at)

      described_class.new.perform(notebook.id, old_requested_at.to_i)

      expect(notebook.reload.ai_summary_update_requested_at).to be_within(1.second).of(new_requested_at)
    end

    it "proceeds if request timestamp matches" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 2.days.ago)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_return("Summary")

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).to have_received(:summarize)
    end
  end

  describe "#perform with no item summaries" do
    it "does not generate summary when no items have ai_summary" do
      message_without_summary = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: nil)
      create(:notebook_item, notebook: notebook, item: message_without_summary, created_at: 2.days.ago)

      requested_at_timestamp = request_summary_update

      expect(KnowledgeService).not_to receive(:summarize)
      expect(LogService).to receive(:log).with(:info, "NotebookSummaryWorker", /No item summaries available/)

      described_class.new.perform(notebook.id, requested_at_timestamp)
    end

    it "clears the pending request so the notebook does not stay in a regenerating state" do
      message_without_summary = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: nil)
      create(:notebook_item, notebook: notebook, item: message_without_summary, created_at: 2.days.ago)

      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).to be_nil
    end

    it "keeps the previous summary" do
      message_without_summary = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: nil)
      create(:notebook_item, notebook: notebook, item: message_without_summary, created_at: 2.days.ago)
      notebook.update_column(:ai_summary, "Previous summary")
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary).to eq("Previous summary")
    end
  end

  describe "#perform with items from a soft-deleted conversation" do
    def soft_deleted_message(summary)
      deleted = create(:conversation, hub: notebook.hub)
      message = create(:message, :outgoing, conversation: deleted, ai_summary: summary)
      deleted.update!(deleted_at: Time.current)
      message
    end

    it "leaves them out of the summary input" do
      create(:notebook_item, notebook: notebook, item: message1)
      create(:notebook_item, notebook: notebook, item: soft_deleted_message("Deleted summary"))
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).to have_received(:summarize).with(["Summary 1"], anything)
    end

    it "clears the summary when only deleted items remain" do
      create(:notebook_item, notebook: notebook, item: soft_deleted_message("Deleted summary"))
      notebook.update_columns(ai_summary: "Old summary")
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary).to be_nil
    end

    it "does not call KnowledgeService when only deleted items remain" do
      create(:notebook_item, notebook: notebook, item: soft_deleted_message("Deleted summary"))
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).not_to have_received(:summarize)
    end
  end

  describe "#perform with no items left" do
    it "clears the notebook's summary so it no longer describes removed items" do
      notebook.update_columns(ai_summary: "Summary of removed items", ai_summary_updated_at: 1.day.ago)
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      notebook.reload
      expect(notebook.ai_summary).to be_nil
      expect(notebook.ai_summary_updated_at).to be_within(1.second).of(Time.now.utc)
    end

    it "clears the pending request so the notebook does not stay in a regenerating state" do
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).to be_nil
    end

    it "does not call KnowledgeService" do
      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).not_to have_received(:summarize)
    end

    it "logs that the summary was cleared" do
      requested_at_timestamp = request_summary_update
      allow(LogService).to receive(:log)

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(LogService).to have_received(:log).with(:info, "NotebookSummaryWorker", /Notebook #{notebook.id} has no items/)
    end
  end

  describe "#perform with an item that cannot be summarized" do
    it "does not generate a partial summary" do
      unsummarizable_conversation = create(:conversation, hub: notebook.hub)
      create(:notebook_item, notebook: notebook, item: message1, created_at: 2.days.ago)
      create(:notebook_item, notebook: notebook, item: unsummarizable_conversation, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize)
      expect(LogService).to receive(:log).with(:info, "NotebookSummaryWorker", /cannot be summarized/)

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).not_to have_received(:summarize)
      expect(notebook.reload.ai_summary).to be_nil
    end

    it "clears the pending request so the notebook does not stay in a regenerating state" do
      unsummarizable_conversation = create(:conversation, hub: notebook.hub)
      create(:notebook_item, notebook: notebook, item: unsummarizable_conversation, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).to be_nil
    end

    it "clears the pending request despite sub-millisecond noise in the timestamp" do
      unsummarizable_conversation = create(:conversation, hub: notebook.hub)
      create(:notebook_item, notebook: notebook, item: unsummarizable_conversation, created_at: 1.day.ago)

      # Fixed value (has a microsecond component) instead of Time.current, so this is deterministic.
      requested_at = Time.utc(2026, 9, 30, 12, 0, 0, 1)
      notebook.update_column(:ai_summary_update_requested_at, requested_at)

      described_class.new.perform(notebook.id, requested_at.to_f)

      expect(notebook.reload.ai_summary_update_requested_at).to be_nil
    end

    it "keeps a previously generated summary when a new item cannot be summarized" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 2.days.ago)
      unsummarizable_conversation = create(:conversation, hub: notebook.hub)
      create(:notebook_item, notebook: notebook, item: unsummarizable_conversation, created_at: 1.day.ago)
      notebook.update_column(:ai_summary, "Summary generated before this item was added")

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_return("New partial summary")

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).not_to have_received(:summarize)
      expect(notebook.reload.ai_summary).to eq("Summary generated before this item was added")
    end
  end

  describe "#perform with an item awaiting Knowledge Service sync" do
    it "does not generate a summary" do
      pending_document = create(:document, content: "", source: create(:source, hub: notebook.hub))
      create(:notebook_item, notebook: notebook, item: message1, created_at: 2.days.ago)
      create(:notebook_item, notebook: notebook, item: pending_document, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      expect(KnowledgeService).not_to receive(:summarize)

      described_class.new.perform(notebook.id, requested_at_timestamp)
    end

    it "leaves the pending request untouched so the notebook keeps polling" do
      pending_document = create(:document, content: "", source: create(:source, hub: notebook.hub))
      create(:notebook_item, notebook: notebook, item: pending_document, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).not_to be_nil
    end

    it "logs that it is waiting on sync" do
      pending_document = create(:document, content: "", source: create(:source, hub: notebook.hub))
      create(:notebook_item, notebook: notebook, item: pending_document, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      expect(LogService).to receive(:log).with(:info, "NotebookSummaryWorker", /awaiting Knowledge Service sync/)

      described_class.new.perform(notebook.id, requested_at_timestamp)
    end
  end

  describe "#perform with mixed items" do
    it "only uses items that have ai_summary" do
      message_with_summary = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: "Has summary")
      message_without_summary = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub), ai_summary: nil)
      create(:notebook_item, notebook: notebook, item: message_with_summary, created_at: 3.days.ago)
      create(:notebook_item, notebook: notebook, item: message_without_summary, created_at: 2.days.ago)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_return("Summary")

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).to have_received(:summarize).with(["Has summary"], default_language: nil)
    end

    it "uses the summary written by a user over the AI summary of a document" do
      document = create(:document, content: "", source: create(:source, hub: notebook.hub), ai_summary: "AI summary", summary: "User summary")
      create(:notebook_item, notebook: notebook, item: document, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(KnowledgeService).to have_received(:summarize).with(["User summary"], default_language: nil)
    end

    it "passes the hub's default_language to KnowledgeService.summarize" do
      hub = create(:hub, bot_attributes: {"name" => "Bot", "description" => "d", "tone" => "friendly", "default_language" => "es"})
      notebook_with_language = create(:notebook, hub: hub)
      message_with_summary = create(:message, :outgoing, conversation: create(:conversation, hub: hub), ai_summary: "Has summary")
      create(:notebook_item, notebook: notebook_with_language, item: message_with_summary, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update(notebook_with_language)

      allow(KnowledgeService).to receive(:summarize).and_return("Resumen")

      described_class.new.perform(notebook_with_language.id, requested_at_timestamp)

      expect(KnowledgeService).to have_received(:summarize).with(["Has summary"], default_language: "es")
    end
  end

  describe "#perform with blank summary response" do
    it "does not update ai_summary when KnowledgeService returns blank" do
      create(:notebook_item, notebook: notebook, item: message1)

      requested_at_timestamp = request_summary_update
      notebook.update_column(:ai_summary, "Old summary")

      allow(KnowledgeService).to receive(:summarize).and_return("")

      described_class.new.perform(notebook.id, requested_at_timestamp)
      notebook.reload

      expect(notebook.ai_summary).to eq("Old summary")
    end

    it "does not clear a request that arrived while the summary was being generated" do
      create(:notebook_item, notebook: notebook, item: message1)

      requested_at_timestamp = request_summary_update
      newer_requested_at = Time.now.utc + 1.minute

      allow(KnowledgeService).to receive(:summarize) do
        notebook.update_column(:ai_summary_update_requested_at, newer_requested_at)
        ""
      end

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).to be_within(1.second).of(newer_requested_at)
    end

    it "clears the pending request when KnowledgeService returns blank" do
      create(:notebook_item, notebook: notebook, item: message1)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_return("")

      described_class.new.perform(notebook.id, requested_at_timestamp)

      expect(notebook.reload.ai_summary_update_requested_at).to be_nil
    end
  end

  describe "#perform with error" do
    it "raises and logs error when notebook not found" do
      expect(LogService).to receive(:log).with(:error, "NotebookSummaryWorker", /Error generating summary/)

      expect {
        described_class.new.perform(999999, Time.now.to_i)
      }.to raise_error(ActiveRecord::RecordNotFound)
    end

    it "raises and logs error when KnowledgeService fails" do
      create(:notebook_item, notebook: notebook, item: message1, created_at: 1.day.ago)

      requested_at_timestamp = request_summary_update

      allow(KnowledgeService).to receive(:summarize).and_raise(StandardError, "API Error")
      expect(LogService).to receive(:log).with(:error, "NotebookSummaryWorker", /Error generating summary/)

      expect {
        described_class.new.perform(notebook.id, requested_at_timestamp)
      }.to raise_error(StandardError, "API Error")
    end
  end

  describe "sidekiq_retries_exhausted callback" do
    it "logs when retries are exhausted" do
      msg = {
        "args" => [notebook.id, Time.now.utc.to_f],
        "jid" => "xyz789"
      }

      expect(LogService).to receive(:log).with(:error, "NotebookSummaryWorker", /Retries exhausted after 3 attempts - Notebook ID: #{notebook.id}, Job ID: xyz789/)

      described_class.sidekiq_retries_exhausted_block.call(msg, StandardError.new("Error"))
    end
  end
end
