require "rails_helper"

RSpec.describe StaleSyncWorker, type: :worker do
  describe "#perform" do
    it "marks sync_status as error when still pending" do
      document = create(:document)

      described_class.new.perform("Document", document.id)

      expect(document.reload.sync_status).to eq("error")
    end

    it "does nothing when sync_status is already complete" do
      document = create(:document)
      document.update_column(:sync_status, :complete)

      described_class.new.perform("Document", document.id)

      expect(document.reload.sync_status).to eq("complete")
    end

    it "does nothing when the document no longer exists" do
      expect { described_class.new.perform("Document", 0) }.not_to raise_error
    end

    it "does not constantize a class outside the syncable allowlist" do
      user = create(:user)

      expect { described_class.new.perform("User", user.id) }.not_to raise_error
    end

    it "handles every model that includes KnowledgeServiceSyncable" do
      notebook = create(:notebook)
      contribution = create(:contribution)

      described_class.new.perform("Notebook", notebook.id)
      described_class.new.perform("Contribution", contribution.id)

      expect(notebook.reload.sync_status).to eq("error")
      expect(contribution.reload.sync_status).to eq("error")
    end

    it "retries item summary generation when it marks a document as error" do
      document = create(:document)
      notebook = create(:notebook, hub: document.hub)
      create(:notebook_item, notebook: notebook, item: document)

      expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook.id)

      described_class.new.perform("Document", document.id)
    end

    it "does not retry item summary generation when the document is already complete" do
      document = create(:document)
      document.update_column(:sync_status, :complete)
      notebook = create(:notebook, hub: document.hub)
      create(:notebook_item, notebook: notebook, item: document)

      expect(ItemSummaryWorker).not_to receive(:perform_async)

      described_class.new.perform("Document", document.id)
    end

    it "marks sync_status as error even if a newer sync has started since this job was scheduled" do
      # Intentional trade-off: we don't track per-attempt state, so a resync that starts
      # before the original 24h check fires still gets marked error. It self-heals once
      # the real callback for the newer attempt lands.
      document = create(:document)
      document.update(active: false)
      document.update(active: true) # simulates a resync after the original job was scheduled

      described_class.new.perform("Document", document.id)

      expect(document.reload.sync_status).to eq("error")
    end
  end
end
