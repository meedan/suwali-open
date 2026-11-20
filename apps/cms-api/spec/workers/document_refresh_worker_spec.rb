require "rails_helper"

RSpec.describe DocumentRefreshWorker, type: :worker do
  describe "#perform" do
    it "refreshes the document's content when the handler supports it" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      website_source = create(:source, source_type: "website", config: {base_url: "https://example.com"})
      document = create(:document, source: website_source, document_type: "blog_post", title: "Old Title", content: "Old Content", metadata: {url: "https://example.com/post-1"})
      document.update_column(:sync_status, :pending)
      doc_data = {title: "New Title", content: "New Content", metadata: {url: "https://example.com/post-1"}}
      refreshed_file = Tempfile.new(["refreshed_", ".txt"])
      refreshed_file.write("New Title\n\nNew Content")
      refreshed_file.rewind
      allow_any_instance_of(SourceIngestors::Website).to receive(:refetch_document_data).and_return(doc_data)
      allow_any_instance_of(SourceIngestors::Website).to receive(:as_file).and_return(refreshed_file.path)

      described_class.new.perform(document.id)

      expect(document.reload.title).to eq("New Title")
      expect(document.content).to eq("New Content")
    end

    it "leaves sync_status at complete when the refreshed content is unchanged" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      website_source = create(:source, source_type: "website", config: {base_url: "https://example.com"})
      document = create(:document, source: website_source, document_type: "blog_post", content: "Same Content")
      document.update_column(:sync_status, :complete)
      doc_data = {title: document.title, content: "Same Content", metadata: {}}
      refreshed_file = Tempfile.new(["refreshed_", ".txt"])
      refreshed_file.write("Same Content")
      refreshed_file.rewind
      allow_any_instance_of(SourceIngestors::Website).to receive(:refetch_document_data).and_return(doc_data)
      allow_any_instance_of(SourceIngestors::Website).to receive(:as_file).and_return(refreshed_file.path)
      expect(KnowledgeServiceWorker).not_to receive(:perform_in)

      described_class.new.perform(document.id)

      expect(document.reload.sync_status).to eq("complete")
    end

    it "marks the document as error and logs when recreate! raises" do
      website_source = create(:source, source_type: "website", config: {base_url: "https://example.com"})
      document = create(:document, source: website_source, document_type: "blog_post")
      document.update_column(:sync_status, :pending)
      allow_any_instance_of(SourceIngestors::Website).to receive(:refetch_document_data).and_raise(StandardError, "fetch failed")

      expect(LogService).to receive(:log).with(:error, "DocumentRefreshWorker", anything)

      described_class.new.perform(document.id)

      expect(document.reload.sync_status).to eq("error")
    end

    it "does nothing when the document no longer exists" do
      expect { described_class.new.perform(0) }.not_to raise_error
    end
  end
end
