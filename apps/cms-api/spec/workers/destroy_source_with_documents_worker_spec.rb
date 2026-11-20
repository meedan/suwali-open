require "rails_helper"

RSpec.describe DestroySourceWithDocumentsWorker, type: :worker do
  describe "#perform" do
    context "when source is marked as deleted" do
      let!(:source) { create(:source) }
      let!(:document1) { create(:document, source: source) }
      let!(:document2) { create(:document, source: source) }

      before do
        source.update_column(:deleted_at, Time.current)
      end

      it "destroys the source" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect {
          described_class.new.perform(source.id)
        }.to change(Source, :count).by(-1)

        expect(Source.find_by(id: source.id)).to be_nil
      end

      it "destroys all documents" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        described_class.new.perform(source.id)

        expect(Document.find_by(id: document1.id)).to be_nil
        expect(Document.find_by(id: document2.id)).to be_nil
      end

      it "triggers KnowledgeService cleanup for each document" do
        allow(LogService).to receive(:log)

        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document1.id, source.hub.id)
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document2.id, source.hub.id)

        described_class.new.perform(source.id)
      end

      it "logs the deletion process" do
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(LogService).to receive(:log).with(:info, "DestroySourceWithDocumentsWorker", "Starting deletion of source #{source.id} with 2 documents")
        expect(LogService).to receive(:log).with(:info, "DestroySourceWithDocumentsWorker", "Successfully deleted source #{source.id}")

        described_class.new.perform(source.id)
      end
    end

    context "when source is not marked as deleted" do
      let!(:source) { create(:source) }

      it "does not delete the source" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(source.id)
        }.not_to change(Source, :count)

        expect(Source.find_by(id: source.id)).not_to be_nil
      end

      it "logs that source is not marked as deleted" do
        expect(LogService).to receive(:log).with(:info, "DestroySourceWithDocumentsWorker", "Source #{source.id} is not marked as deleted, skipping")

        described_class.new.perform(source.id)
      end
    end

    context "when source does not exist" do
      it "logs that source was not found" do
        expect(LogService).to receive(:log).with(:info, "DestroySourceWithDocumentsWorker", "Source 999999 not found, may have already been deleted")

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
      let!(:source) { create(:source) }

      before do
        source.update_column(:deleted_at, Time.current)
      end

      it "running twice does not raise an error" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        # First run - deletes the source
        described_class.new.perform(source.id)

        # Second run - source already deleted
        expect {
          described_class.new.perform(source.id)
        }.not_to raise_error
      end
    end
  end
end
