require "rails_helper"

RSpec.describe Document, type: :model do
  it "is valid with valid attributes" do
    document = build(:document)
    expect(document).to be_valid
  end

  it { expect(build(:document)).to validate_length_of(:summary).is_at_most(Document::MAX_SUMMARY_LENGTH) }

  it "is valid without a published_at" do
    document = build(:document, published_at: nil)
    expect(document).to be_valid
  end

  it "persists published_at as a timestamp" do
    published_at = Time.zone.parse("2024-01-01T10:00:00Z")
    document = create(:document, published_at: published_at)
    expect(document.reload.published_at).to eq(published_at)
  end

  it "is invalid without a title" do
    document = build(:document, title: nil)
    expect(document).not_to be_valid
  end

  it "is invalid without a type" do
    document = build(:document, document_type: nil)
    expect(document).not_to be_valid
  end

  it "is invalid with invalid type" do
    expect {
      build(:document, document_type: "video")
    }.to raise_error(ArgumentError)
  end

  it "supports creating a document for each of the documented types" do
    types = %w[pdf doc blog_post docx txt rss_entry json md markdown]

    expect(Document.document_types.keys).to match_array(types)

    types.each do |type|
      document = create(:document, document_type: type)
      expect(document.reload.document_type).to eq(type)
    end
  end

  it "belongs to a source" do
    source = create(:source)
    document = create(:document, source: source)
    expect(document.source).to eq(source)
  end

  it "enforces uniqueness of external_id scoped to source" do
    source = create(:source)
    doc1 = source.documents.create!(
      external_id: "abc123",
      title: "First Title",
      content: "Initial content",
      metadata: {url: "http://example.com/1"},
      document_type: "blog_post"
    )

    # Attempt to create a duplicate
    doc2 = source.documents.find_or_initialize_by(external_id: "abc123")
    doc2.update!(
      title: "Updated Title",
      content: "Updated content",
      metadata: {url: "http://example.com/1"},
      document_type: "blog_post"
    )

    expect(Document.count).to eq(1)
    expect(doc1.reload.title).to eq("Updated Title")
    expect(doc1.reload.content).to eq("Updated content")
  end

  it "allows same external_id across different sources" do
    hub = create(:hub, plan: :enterprise)
    source = create(:source, hub: hub)
    other_source = create(:source, hub: hub)
    source.documents.create!(external_id: "shared-id", title: "From first source", document_type: "pdf")
    other_source.documents.create!(external_id: "shared-id", title: "From second source", document_type: "pdf")

    expect(Document.count).to eq(2)
    expect(source.documents.find_by(external_id: "shared-id").title).to eq("From first source")
    expect(other_source.documents.find_by(external_id: "shared-id").title).to eq("From second source")
  end

  it "enqueues KnowledgeServiceWorker after create" do
    expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", anything)
    create(:document)
  end

  it "re-ingests an active document when its summary changes" do
    document = create(:document, active: true)
    expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", document.id)
    document.update!(summary: "User summary")
    expect(document.reload.sync_status).to eq("pending")
  end

  it "does not re-ingest a paused document when its summary changes" do
    document = create(:document, active: false)
    expect(KnowledgeServiceWorker).not_to receive(:perform_in)
    document.update!(summary: "User summary")
  end

  it "updates the summaries of the notebooks holding the document when its summary changes" do
    document = create(:document)
    notebook = create(:notebook, hub: document.hub)
    create(:notebook_item, notebook: notebook, item: document)

    expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook.id)
    document.update!(summary: "User summary")

    expect(ItemSummaryWorker).not_to receive(:perform_async)
    document.update!(priority_tier: 2)
  end

  it "does not enqueue KnowledgeServiceWorker after create when the caller handles the ingestion" do
    expect(KnowledgeServiceWorker).not_to receive(:perform_in)
    document = build(:document)
    document.skip_automatic_ingestion = true
    document.save!
  end

  it "can be a notebook item" do
    hub = create(:hub, plan: :enterprise)
    source = create(:source, hub: hub)
    document = create(:document, source: source)
    notebook = create(:notebook, hub: hub)
    notebook.documents << document
    expect(document.reload.notebooks.to_a).to eq([notebook])
  end

  it "enqueues KnowledgeServiceWorker after destroy" do
    document = create(:document)
    expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", anything, anything)
    document.destroy
  end

  it "returns data_source_payload" do
    document = create(:document)

    expect(document.data_source_payload).to include({
      external_url: document.external_url,
      updated_at: document.updated_at,
      active: document.active,
      document_type: document.document_type,
      document_size: document.document_size,
      content: document.content
    })
  end

  it "includes its topics in as_json sorted by name" do
    document = create(:document)
    document.hub.topics.create!(name: "Elections").tap { |topic| document.topics << topic }
    document.hub.topics.create!(name: "Climate").tap { |topic| document.topics << topic }

    expect(document.as_json[:topics].map(&:as_json).map { |topic| topic[:name] }).to eq(["Climate", "Elections"])
  end

  it "includes refresh_supported in as_json" do
    document = build(:document, sync_status: :complete, source: build(:source, source_type: "website"))
    expect(document.as_json[:refresh_supported]).to be(true)
  end

  describe "#refresh_supported?" do
    context "when sync_status is complete" do
      it "is true when the source supports refresh" do
        document = build(:document, sync_status: :complete, source: build(:source, source_type: "website"))
        expect(document.refresh_supported?).to be(true)
      end

      it "is false when the source does not support refresh" do
        document = build(:document, sync_status: :complete, source: build(:source, source_type: "json_api"))
        expect(document.refresh_supported?).to be(false)
      end

      it "is false for the deprecated conversation source type instead of raising" do
        document = build(:document, sync_status: :complete, source: build(:source, source_type: "conversation"))
        expect(document.refresh_supported?).to be(false)
      end
    end

    context "when sync_status is not complete" do
      it "is false when error, even if the source supports refresh" do
        document = build(:document, sync_status: :error, source: build(:source, source_type: "website"))
        expect(document.refresh_supported?).to be(false)
      end

      it "is false when pending, even if the source supports refresh" do
        document = build(:document, sync_status: :pending, source: build(:source, source_type: "website"))
        expect(document.refresh_supported?).to be(false)
      end
    end
  end

  it "creates deleted document after destroy" do
    document = create(:document)
    expect(DeletedDocument.where(source: document.source, external_id: document.external_id).first).to be_nil
    document.destroy
    expect(DeletedDocument.where(source: document.source, external_id: document.external_id).first).not_to be_nil
  end

  it "is invalid when source is deleted" do
    source = create(:source, deleted_at: Time.current)
    document = build(:document, source: source)
    expect(document).not_to be_valid
    expect(document.errors[:base][0]).to include("deleted")
  end

  describe "#attach_file!" do
    it "sets document_size to the attached file's byte size" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document)
      content = "some file content"
      tempfile = Tempfile.new
      tempfile.write(content)
      tempfile.rewind

      document.attach_file!(tempfile.path)

      expect(document.reload.document_size).to eq(content.bytesize)
    end

    it "cleans up the tempfile if the enclosing transaction rolls back" do
      document = create(:document)
      tempfile = Tempfile.new
      tempfile.write("content")
      tempfile.rewind
      path = tempfile.path

      expect {
        ActiveRecord::Base.transaction do
          document.attach_file!(path)
          raise ActiveRecord::Rollback
        end
      }.to change { File.exist?(path) }.from(true).to(false)
    end

    it "uploads to storage synchronously, even inside an enclosing transaction" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document)
      tempfile = Tempfile.new
      tempfile.write("content")
      tempfile.rewind
      path = tempfile.path

      ActiveRecord::Base.transaction do
        document.attach_file!(path)
        blob = document.file.blob
        expect(blob.service.exist?(blob.key)).to be(true)
      end
    end

    it "purges the blob's storage object if the enclosing transaction rolls back" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document)
      tempfile = Tempfile.new
      tempfile.write("content")
      tempfile.rewind
      path = tempfile.path

      blob = nil
      ActiveRecord::Base.transaction do
        document.attach_file!(path)
        blob = document.file.blob
        expect(blob.service.exist?(blob.key)).to be(true)
        raise ActiveRecord::Rollback
      end

      expect(blob.service.exist?(blob.key)).to be(false)
    end

    it "replaces an existing attachment sharing the same deterministic key without raising" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document)
      first = Tempfile.new(["first_", ".txt"])
      first.write("first content")
      first.rewind
      document.attach_file!(first.path)

      second = Tempfile.new(["second_", ".txt"])
      second.write("second content")
      second.rewind

      expect { document.attach_file!(second.path) }.not_to raise_error
      expect(document.reload.file.download).to eq("second content")
    end
  end

  describe "#file_missing?" do
    it "returns true when no file is attached" do
      document = create(:document)
      expect(document.file_missing?).to be(true)
    end

    it "returns true when attached but the blob is missing from storage" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document, :with_pdf)
      allow(document.file.blob.service).to receive(:exist?).and_return(false)
      expect(document.file_missing?).to be(true)
    end

    it "returns false when attached and the blob exists in storage" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      document = create(:document, :with_pdf)
      expect(document.file_missing?).to be(false)
    end
  end

  describe "#reattach_file!" do
    it "attaches a new file built from title and content for public source types" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      source = create(:source, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"})
      document = create(:document, source: source, document_type: "rss_entry", title: "My Title", content: "My Content")

      document.reattach_file!

      expect(document.reload.file).to be_attached
      expect(document.file.download).to include("My Title", "My Content")
    end

    it "writes the published_at column into the file" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      source = create(:source, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"})
      document = create(:document, source: source, document_type: "rss_entry", published_at: Time.utc(2024, 1, 1, 10), metadata: {published_at: "2020-05-05T05:00:00Z"})

      document.reattach_file!

      expect(document.reload.file.download).to include("Date: 2024-01-01")
    end

    it "does not use the metadata date when published_at is nil" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      source = create(:source, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"})
      document = create(:document, source: source, document_type: "rss_entry", metadata: {published_at: "2020-05-05T05:00:00Z"})

      document.reattach_file!

      expect(document.reload.file.download).not_to include("2020-05-05")
    end

    it "does not reattach when the file is already present" do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

      source = create(:source, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"})
      document = create(:document, :with_pdf, source: source, document_type: "rss_entry")
      expect(document.source).not_to receive(:handler)
      document.reattach_file!
    end

    it "does nothing for uploaded_files sources when the file is missing" do
      source = create(:source, source_type: "uploaded_files")
      document = create(:document, source: source, document_type: "pdf")
      document.reattach_file!
      expect(document.reload.file).not_to be_attached
    end

    it "does nothing for google_drive_folder sources when the file is missing" do
      source = create(:source, source_type: "google_drive_folder")
      document = create(:document, source: source, document_type: "pdf")
      document.reattach_file!
      expect(document.reload.file).not_to be_attached
    end
  end

  describe "#recreate!" do
    context "when the handler doesn't support refresh" do
      it "raises RefreshNotSupportedError when the source handler doesn't implement refetch_document_data" do
        document = create(:document)
        allow(document.source).to receive(:handler).and_return(double("handler"))

        expect { document.recreate! }.to raise_error(Document::RefreshNotSupportedError)
      end

      it "raises RefreshNotSupportedError when the source has no handler" do
        source = create(:source, source_type: "uploaded_files")
        document = create(:document, source: source)

        expect { document.recreate! }.to raise_error(Document::RefreshNotSupportedError)
      end
    end

    context "when the handler supports refresh" do
      it "updates title, content, and metadata from the handler's returned doc_data" do
        document = create(:document, title: "Old Title", content: "Old content", metadata: {url: "http://example.com/1"})
        doc_data = {title: "New Title", content: "New content", metadata: {url: "http://example.com/1"}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(document.reload.title).to eq("New Title")
        expect(document.content).to eq("New content")
        expect(document.metadata).to eq({"url" => "http://example.com/1"})
      end

      it "keeps the original published_at" do
        original = Time.utc(2024, 1, 1, 10)
        document = create(:document, published_at: original)
        doc_data = {title: "New Title", content: "New content", date: Time.utc(2025, 2, 2, 2), metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(document.reload.published_at).to eq(original)
      end

      it "attaches the file built from the handler's doc_data" do
        document = create(:document)
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(document).to have_received(:attach_file!).with("/tmp/fake_file.txt")
      end

      it "triggers a Knowledge Service resync because content changed" do
        document = create(:document, active: true, content: "Old content")
        document.update_column(:sync_status, :complete)
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", document.id)

        document.recreate!

        expect(document.reload.sync_status).to eq("pending")
      end

      it "does not resync when the refreshed content is unchanged" do
        document = create(:document, active: true, content: "Same content")
        document.update_column(:sync_status, :complete)
        doc_data = {title: document.title, content: "Same content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)
        expect(KnowledgeServiceWorker).not_to receive(:perform_in)

        document.recreate!

        expect(document.reload.sync_status).to eq("complete")
      end
    end

    context "building the payload for the handler" do
      it "passes only the url for a website source" do
        source = create(:source, source_type: "website")
        document = create(:document, source: source, external_id: "guid-1", title: "Old Title", metadata: {url: "http://example.com/1"})
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(handler).to have_received(:refetch_document_data).with(url: "http://example.com/1")
      end

      it "passes only the external_id for a google_drive_folder source" do
        source = create(:source, source_type: "google_drive_folder")
        document = create(:document, source: source, external_id: "drive-file-1")
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(handler).to have_received(:refetch_document_data).with(external_id: "drive-file-1")
      end

      it "passes only the external_id for a wordpress_api source" do
        source = create(:source, :wordpress_api)
        document = create(:document, source: source, external_id: "123")
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(handler).to have_received(:refetch_document_data).with(external_id: "123")
      end

      it "passes the url, title, and full metadata for an rss_feed source" do
        source = create(:source, source_type: "rss_feed")
        document = create(:document, source: source, title: "Old Title", metadata: {url: "http://example.com/1", description: "desc"})
        doc_data = {title: "New Title", content: "New content", metadata: {}}
        handler = double("handler", refetch_document_data: doc_data, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!)

        document.recreate!

        expect(handler).to have_received(:refetch_document_data).with(
          url: "http://example.com/1", title: "Old Title", metadata: {"url" => "http://example.com/1", "description" => "desc"}
        )
      end
    end

    context "when the handler's refresh fails" do
      it "rolls back the title/content/metadata update if attach_file! raises" do
        document = create(:document, title: "Old Title")
        handler = double("handler", refetch_document_data: {title: "New Title", content: "New content", metadata: {}}, as_file: "/tmp/fake_file.txt")
        allow(document.source).to receive(:handler).and_return(handler)
        allow(document).to receive(:attach_file!).and_raise(StandardError, "upload failed")

        expect { document.recreate! }.to raise_error(StandardError, "upload failed")

        expect(document.reload.title).to eq("Old Title")
      end

      it "propagates the error and makes no changes when refetch_document_data raises" do
        document = create(:document, title: "Old Title")
        handler = double("handler")
        allow(handler).to receive(:refetch_document_data).and_raise(StandardError, "fetch failed")
        allow(document.source).to receive(:handler).and_return(handler)

        expect { document.recreate! }.to raise_error(StandardError, "fetch failed")

        expect(document.reload.title).to eq("Old Title")
      end
    end
  end

  describe ".ordered_by_published_at" do
    it "orders by published_at, then undated documents by updated_at, ties by id" do
      source = create(:source)
      older = create(:document, source: source, published_at: 20.days.ago, updated_at: 1.day.ago)
      newer = create(:document, source: source, published_at: 10.days.ago, updated_at: 1.day.ago)
      undated_old = create(:document, source: source, published_at: nil, updated_at: 30.days.ago)
      undated_new = create(:document, source: source, published_at: nil, updated_at: 15.days.ago)

      expect(source.documents.ordered_by_published_at("asc")).to eq([older, newer, undated_old, undated_new])
      expect(source.documents.ordered_by_published_at("desc")).to eq([newer, older, undated_new, undated_old])
    end
  end

  describe ".accessible_by" do
    it "returns all documents for super-admins regardless of hub membership" do
      source = create(:source)
      document = create(:document, source: source)
      super_admin = create(:user, email: "admin@meedan.com")

      expect(Document.accessible_by(super_admin)).to include(document)
    end
  end

  describe ".public_source" do
    it "includes active documents from public-facing sources" do
      document = create(:document, source: create(:source, source_type: :rss_feed))
      expect(Document.public_source).to include(document)
    end

    it "includes active documents from WordPress sources" do
      document = create(:document, source: create(:source, :wordpress_api))
      expect(Document.public_source).to include(document)
    end

    it "excludes documents from non-public sources" do
      document = create(:document, source: create(:source, source_type: :uploaded_files))
      expect(Document.public_source).not_to include(document)
    end

    it "excludes inactive documents from public sources" do
      document = create(:document, source: create(:source, source_type: :rss_feed), active: false)
      expect(Document.public_source).not_to include(document)
    end
  end

  describe ".parse_published_at" do
    it "parses an ISO 8601 string" do
      expect(Document.parse_published_at("2024-01-01T10:00:00Z")).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "converts a Time" do
      expect(Document.parse_published_at(Time.utc(2024, 1, 1, 10))).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "converts a DateTime" do
      expect(Document.parse_published_at(DateTime.new(2024, 1, 1, 10))).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "returns nil for nil" do
      expect(Document.parse_published_at(nil)).to be_nil
    end

    it "returns nil for a blank string" do
      expect(Document.parse_published_at("   ")).to be_nil
    end

    it "returns nil for an unparseable string" do
      expect(Document.parse_published_at("not a date")).to be_nil
    end

    it "returns nil for an invalid date" do
      expect(Document.parse_published_at("2024-13-45")).to be_nil
    end

    it "returns nil for an unsupported type" do
      expect(Document.parse_published_at(12345)).to be_nil
    end
  end

  describe "#public_source?" do
    it "is true for an active document from a public source" do
      expect(create(:document, source: create(:source, source_type: :rss_feed)).public_source?).to be(true)
    end

    it "is false for a document from a non-public source" do
      expect(create(:document, source: create(:source, source_type: :uploaded_files)).public_source?).to be(false)
    end

    it "is false for an inactive document" do
      expect(create(:document, source: create(:source, source_type: :rss_feed), active: false).public_source?).to be(false)
    end
  end

  describe "#text_for_summarization" do
    it "returns the document content" do
      document = create(:document, content: "Document content here")
      expect(document.text_for_summarization).to eq("Document content here")
    end
  end

  describe "#summarize_ingested_content" do
    it "summarizes the document's ingested text when sync is complete" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :complete)
      allow(KnowledgeService).to receive(:summarize)
        .with(hub_id: document.hub.id, document_id: Base64.encode64("Document/#{document.id}"), default_language: document.hub.default_language)
        .and_return("A summary from ingested chunks")

      expect(document.summarize_ingested_content).to eq("A summary from ingested chunks")
    end

    it "returns nil without calling KnowledgeService when sync is pending" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :pending)
      expect(KnowledgeService).not_to receive(:summarize)

      expect(document.summarize_ingested_content).to be_nil
    end

    it "returns nil without calling KnowledgeService when sync is error" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :error)
      expect(KnowledgeService).not_to receive(:summarize)

      expect(document.summarize_ingested_content).to be_nil
    end

    it "returns nil without calling KnowledgeService when the document is inactive" do
      document = create(:document, content: "", active: false)
      document.update_column(:sync_status, :complete)
      expect(KnowledgeService).not_to receive(:summarize)

      expect(document.summarize_ingested_content).to be_nil
    end
  end

  describe "#retry_item_summary_generation" do
    it "enqueues ItemSummaryWorker for each notebook holding the document" do
      document = create(:document)
      notebook_a = create(:notebook, hub: document.hub)
      notebook_b = create(:notebook, hub: document.hub)
      create(:notebook_item, notebook: notebook_a, item: document)
      create(:notebook_item, notebook: notebook_b, item: document)

      expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook_a.id)
      expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook_b.id)

      document.retry_item_summary_generation
    end

    it "does nothing when the document has an ai_summary already" do
      document = create(:document)
      notebook = create(:notebook, hub: document.hub)
      create(:notebook_item, notebook: notebook, item: document)
      document.update_column(:ai_summary, "Existing summary")

      expect(ItemSummaryWorker).not_to receive(:perform_async)

      document.retry_item_summary_generation
    end

    it "does nothing when the document is in no notebook" do
      document = create(:document)

      expect(ItemSummaryWorker).not_to receive(:perform_async)

      document.retry_item_summary_generation
    end
  end

  describe "#effective_summary" do
    it "prefers the summary written by a user over the AI summary" do
      expect(build(:document, summary: "User summary", ai_summary: "AI summary").effective_summary).to eq("User summary")
    end

    it "falls back to the AI summary" do
      expect(build(:document, summary: "", ai_summary: "AI summary").effective_summary).to eq("AI summary")
    end
  end

  describe "#summarizable?" do
    it "is true when the document has only a summary written by a user" do
      expect(build(:document, content: "", summary: "User summary").summarizable?).to be(true)
    end

    it "is false when the document has no content or summary" do
      expect(build(:document, content: "").summarizable?).to be(false)
    end
  end

  describe "#awaiting_sync_for_summary?" do
    it "is true when sync is pending and there is no content or summary yet" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :pending)

      expect(document.awaiting_sync_for_summary?).to be(true)
    end

    it "is false when the document has content" do
      document = create(:document, content: "Some content")
      document.update_column(:sync_status, :pending)

      expect(document.awaiting_sync_for_summary?).to be(false)
    end

    it "is false when the document already has an ai_summary" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :pending)
      document.update_column(:ai_summary, "Existing summary")

      expect(document.awaiting_sync_for_summary?).to be(false)
    end

    it "is false when the document has a summary written by a user" do
      document = create(:document, content: "", summary: "User summary")
      document.update_column(:sync_status, :pending)

      expect(document.awaiting_sync_for_summary?).to be(false)
    end

    it "is false when sync is complete" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :complete)

      expect(document.awaiting_sync_for_summary?).to be(false)
    end

    it "is false when sync is error" do
      document = create(:document, content: "")
      document.update_column(:sync_status, :error)

      expect(document.awaiting_sync_for_summary?).to be(false)
    end

    it "is false when the document is inactive" do
      document = create(:document, content: "", active: false)
      document.update_column(:sync_status, :pending)

      expect(document.awaiting_sync_for_summary?).to be(false)
    end
  end

  describe "#content_snippet" do
    it "collapses whitespace and truncates at a word boundary" do
      document = create(:document, content: "First line\nsecond   line. #{"word " * 60}")
      snippet = document.content_snippet

      expect(snippet).to start_with("First line second line.")
      expect(snippet).to end_with("…")
      expect(snippet.length).to be <= 150
    end

    it "returns an empty string when there is no content" do
      document = create(:document, content: nil)
      expect(document.content_snippet).to eq("")
    end
  end

  describe "plan restrictions" do
    it "allows creating document on premium hub" do
      hub = create(:hub, plan: :enterprise)
      allow(hub).to receive(:max_sources_for_plan).and_return(3)
      source = create(:source, hub: hub)
      4.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end

    it "allows creating documents under limit on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      allow(hub).to receive(:max_sources_for_plan).and_return(3)
      source = create(:source, hub: hub)
      2.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end

    it "rejects creating document over limit on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      allow(hub).to receive(:max_documents_for_plan).and_return(3)
      source = create(:source, hub: hub)
      3.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).not_to be_valid
      expect(document.errors[:base]).to include(I18n.t(:error_plan_restriction_max_documents_reached, max: 3))
    end

    it "allows creating unlimited documents on free_unrestricted hub" do
      hub = create(:hub, plan: :free_unrestricted)
      allow(hub).to receive(:max_documents_for_plan).and_return(nil)
      source = create(:source, hub: hub)
      4.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end

    it "rejects creating documents on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub)
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)
      document = build(:document, source: source)
      expect(document).not_to be_valid
      expect(document.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "allows creating documents on free_unrestricted hub with active trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      allow(hub).to receive(:max_sources_for_plan).and_return(nil)
      source = create(:source, hub: hub)
      4.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end

    it "allows creating documents up to custom limit on enterprise hub" do
      hub = create(:hub, plan: :enterprise, custom_limits: {documents: 3})
      source = create(:source, hub: hub)
      2.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end

    it "rejects creating documents over custom limit on enterprise hub" do
      hub = create(:hub, plan: :enterprise, custom_limits: {documents: 3})
      source = create(:source, hub: hub)
      3.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).not_to be_valid
      expect(document.errors[:base]).to include(I18n.t(:error_plan_restriction_max_documents_reached, max: 3))
    end

    it "allows unlimited documents when custom_limits not set on enterprise hub" do
      hub = create(:hub, plan: :enterprise)
      source = create(:source, hub: hub)
      100.times { create(:document, source: source) }
      document = build(:document, source: source)
      expect(document).to be_valid
    end
  end

  it "includes priority_tier in data_source_payload" do
    document = create(:document, priority_tier: 2)
    expect(document.data_source_payload).to include(priority_tier: 2)
  end

  it_behaves_like "knowledge_service_syncable"
end
