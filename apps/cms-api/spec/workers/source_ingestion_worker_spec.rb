require "rails_helper"

RSpec.describe SourceIngestionWorker, type: :worker do
  let!(:source) { create(:source, source_type: "website", active: true) }

  before do
    # Stub the ingestor to return mock documents
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:call).and_return([[
      {
        external_id: "doc-123",
        title: "Test Document",
        content: "Some content here",
        metadata: {url: "http://example.com"},
        document_type: "blog_post"
      }
    ], 1])
    website_tempfile = Tempfile.new
    website_tempfile.write("Some file content")
    website_tempfile.rewind
    allow(ingestor).to receive(:as_file).and_return(website_tempfile)
  end

  it "processes an active website source and creates a document" do
    require "webmock/rspec"
    WebMock.disable_net_connect!(allow: [/silo/, /localhost/])

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)

    doc = source.documents.find_by(external_id: "doc-123")
    expect(doc).to be_present
    expect(doc.title).to eq("Test Document")
    expect(doc.document_size).to eq("Some file content".bytesize)
    expect(source.reload.last_synced_at).to be_within(5.seconds).of(Time.current)
  end

  it "processes an active Google Drive folder source and creates a document" do
    source.update!(source_type: "google_drive_folder")
    other_ingestor = instance_double(SourceIngestors::GoogleDriveFolder)
    allow(SourceIngestors::GoogleDriveFolder).to receive(:new).and_return(other_ingestor)
    allow(other_ingestor).to receive(:call).and_return([[
      {
        external_id: "doc-123",
        title: "test.pdf",
        content: nil,
        metadata: {},
        document_type: "pdf"
      }
    ], 1])

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)

    doc = source.documents.find_by(external_id: "doc-123")
    expect(doc).to be_present
    expect(doc.title).to eq("test.pdf")
    expect(doc.public_url).to be_nil
    expect(source.reload.last_synced_at).to be_within(5.seconds).of(Time.current)
  end

  it "processes an active RSS Feed source and creates a document" do
    source.update!(source_type: "rss_feed")
    other_ingestor = instance_double(SourceIngestors::RssFeed)
    allow(SourceIngestors::RssFeed).to receive(:new).and_return(other_ingestor)
    allow(other_ingestor).to receive(:call).and_return([[
      {
        external_id: "guid-123",
        title: "RSS feed item title",
        content: "RSS feed item content",
        metadata: {},
        document_type: "rss_entry"
      }
    ], 1])

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)

    doc = source.documents.find_by(external_id: "guid-123")
    expect(doc).to be_present
    expect(doc.title).to eq("RSS feed item title")
    expect(source.reload.last_synced_at).to be_within(5.seconds).of(Time.current)
  end

  it "processes an active JSON API source and creates a document" do
    source.update!(source_type: "json_api")
    other_ingestor = instance_double(SourceIngestors::JsonApi)
    allow(SourceIngestors::JsonApi).to receive(:new).and_return(other_ingestor)
    allow(other_ingestor).to receive(:call).and_return([[
      {
        external_id: "json-123",
        title: "JSON API item title",
        content: "JSON API item content",
        metadata: {},
        document_type: "json"
      }
    ], 1])

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)

    doc = source.documents.find_by(external_id: "json-123")
    expect(doc).to be_present
    expect(doc.title).to eq("JSON API item title")
    expect(source.reload.last_synced_at).to be_within(5.seconds).of(Time.current)
  end

  describe "published_at" do
    def ingest_dated_document(source_type, ingestor_class, document_type, date)
      source.update!(source_type: source_type)
      ingestor = instance_double(ingestor_class)
      allow(ingestor_class).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:call).and_return([[
        {external_id: "dated-1", title: "Dated", content: "c", metadata: {}, document_type: document_type, date: date}
      ], 1])

      described_class.new.perform(source.id)

      source.documents.find_by(external_id: "dated-1")
    end

    it "is set from the RSS feed document date" do
      document = ingest_dated_document("rss_feed", SourceIngestors::RssFeed, "rss_entry", Time.utc(2024, 1, 1, 10))

      expect(document.published_at).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "is set from the JSON API document date" do
      document = ingest_dated_document("json_api", SourceIngestors::JsonApi, "json", "2024-01-01T10:00:00Z")

      expect(document.published_at).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "is set from the Google Drive file created time" do
      document = ingest_dated_document("google_drive_folder", SourceIngestors::GoogleDriveFolder, "pdf", DateTime.new(2024, 1, 1, 10))

      expect(document.published_at).to eq(Time.utc(2024, 1, 1, 10))
    end

    it "is nil when the document has no date" do
      described_class.new.perform(source.id)

      expect(source.documents.find_by(external_id: "doc-123").published_at).to be_nil
    end

    it "is nil, without failing ingestion, when the date is unparseable" do
      document = ingest_dated_document("json_api", SourceIngestors::JsonApi, "json", "not a date")

      expect(document.published_at).to be_nil
    end
  end

  it "does not process an inactive source" do
    source.update!(active: false)

    expect {
      described_class.new.perform(source.id)
    }.not_to change(Document, :count)
  end

  it "skips ingestion if already in progress" do
    source.update_columns(ingestion_started_at: 10.minutes.ago)

    result = described_class.new.perform(source.id)

    expect(result).to eq(false)
    expect(Document.count).to eq(0)
  end

  it "clears ingestion_started_at after successful ingestion" do
    described_class.new.perform(source.id)

    expect(source.reload.ingestion_started_at).to be_nil
  end

  it "clears ingestion_started_at even when ingestion raises an error" do
    allow(source).to receive(:handler).and_raise(StandardError, "network error")
    allow(Source).to receive(:find_by).with(id: source.id).and_return(source)

    expect {
      described_class.new.perform(source.id)
    }.to raise_error(StandardError, "network error")

    expect(source.reload.ingestion_started_at).to be_nil
  end

  it "re-runs ingestion for a source with a stale ingestion_started_at" do
    source.update_columns(ingestion_started_at: 25.hours.ago)

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)
  end

  it "skips a failed document and continues ingesting remaining documents" do
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:call).and_return([[
      {external_id: "doc-fail", title: nil, content: nil, metadata: nil, document_type: nil},
      {external_id: "doc-ok", title: "Good Doc", content: "content", metadata: {}, document_type: "blog_post"}
    ], 2])
    allow(ingestor).to receive(:as_file).and_return(Tempfile.new)

    # First doc will fail validation (title is nil but let's force a DB error via duplicate)
    allow(source.documents).to receive(:create!).and_call_original
    allow(source.documents).to receive(:create!).with(hash_including(external_id: "doc-fail")).and_raise(ActiveRecord::RecordInvalid)

    expect {
      described_class.new.perform(source.id)
    }.to change(Document, :count).by(1)

    expect(source.documents.find_by(external_id: "doc-ok")).to be_present

    failed = source.reload.last_ingestion_errors.find { |e| e["external_id"] == "doc-fail" }
    expect(failed["reason"]).to eq("import_failed")
  end

  it "persists handler-reported errors and overwrites them on the next run" do
    source.update!(source_type: "google_drive_folder")
    ingestor = instance_double(SourceIngestors::GoogleDriveFolder)
    allow(SourceIngestors::GoogleDriveFolder).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:as_file).and_return(Tempfile.new)
    allow(ingestor).to receive(:full_sync?).and_return(true)
    allow(ingestor).to receive(:call).and_return([
      [], 0, "Folder",
      [{external_id: "skip-1", title: "big.pdf", link: "http://example.com", reason: "file_too_large", details: nil}]
    ])

    described_class.new.perform(source.id)

    errors = source.reload.last_ingestion_errors
    expect(errors.size).to eq(1)
    expect(errors.first["external_id"]).to eq("skip-1")
    expect(errors.first["reason"]).to eq("file_too_large")

    # A subsequent run with nothing skipped clears the previous report
    allow(ingestor).to receive(:call).and_return([[], 0, "Folder", []])
    described_class.new.perform(source.id)

    expect(source.reload.last_ingestion_errors).to eq([])
  end

  it "keeps previous errors on incremental sources until the item is imported" do
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:as_file).and_return(Tempfile.new)
    allow(ingestor).to receive(:call).and_return([
      [], 2, "Site",
      [
        {external_id: "post-1", title: "post-1", link: "http://example.com/1", reason: "fetch_failed", details: "403"},
        {external_id: "post-2", title: "post-2", link: "http://example.com/2", reason: "fetch_failed", details: "429"}
      ]
    ])
    described_class.new.perform(source.id)

    # The next sync stops before reaching the failed posts, but imports post-2 from elsewhere
    allow(ingestor).to receive(:call).and_return([
      [{external_id: "post-2", title: "Post 2", content: "content", metadata: {}, document_type: "blog_post"}], 1, "Site", []
    ])
    described_class.new.perform(source.id)

    expect(source.reload.last_ingestion_errors.map { |e| e["external_id"] }).to eq(["post-1"])
  end

  it "clears a previous error once its URL is imported under a different external_id" do
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:as_file).and_return(Tempfile.new)
    allow(ingestor).to receive(:call).and_return([
      [], 1, "Site",
      [{external_id: "http://example.com/1", title: "http://example.com/1", link: "http://example.com/1", reason: "fetch_failed", details: "429"}]
    ])
    described_class.new.perform(source.id)

    allow(ingestor).to receive(:call).and_return([
      [{external_id: "custom-id-1", title: "Post 1", content: "content", metadata: {url: "http://example.com/1"}, document_type: "blog_post"}], 1, "Site", []
    ])
    described_class.new.perform(source.id)

    expect(source.reload.last_ingestion_errors).to eq([])
  end

  it "raises an error for unknown source_type" do
    source.update!(source_type: "conversation")

    expect {
      described_class.new.perform(source.id)
    }.to raise_error("No handler for source type conversation")
  end

  it "does not process source when hub can't add documents" do
    hub_double = instance_double(Hub,
      id: 1,
      name: "Test Hub",
      can_add_document?: false,
      blocks_creation_due_to_expired_trial?: false)
    source_double = instance_double(Source,
      id: 999,
      name: "Test Source",
      hub: hub_double,
      deleted?: false,
      uploaded_files?: false,
      active?: true)

    allow(Source).to receive(:find_by).with(id: 999).and_return(source_double)
    allow(source_double).to receive(:reload).and_return(source_double)
    allow(source_double).to receive(:last_synced_at).and_return(nil)

    result = described_class.new.perform(999)

    expect(result).to eq(false)
  end

  it "does not process source when it's deleted" do
    hub_double = instance_double(Hub,
      id: 1,
      name: "Test Hub",
      can_add_document?: true,
      blocks_creation_due_to_expired_trial?: false)
    source_double = instance_double(Source,
      id: 999,
      name: "Test Source",
      hub: hub_double,
      deleted?: true,
      active?: true)

    allow(Source).to receive(:find_by).with(id: 999).and_return(source_double)
    allow(source_double).to receive(:reload).and_return(source_double)
    allow(source_double).to receive(:last_synced_at).and_return(nil)

    result = described_class.new.perform(999)

    expect(result).to eq(false)
  end

  describe "public_url" do
    def ingest_document_with_public_url(public_url)
      source.update!(source_type: "rss_feed")
      ingestor = instance_double(SourceIngestors::RssFeed)
      allow(SourceIngestors::RssFeed).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:call).and_return([[
        {external_id: "public-1", title: "Public", content: "c", metadata: {}, document_type: "rss_entry", public_url: public_url}
      ], 1])

      described_class.new.perform(source.id)

      source.documents.find_by(external_id: "public-1")
    end

    it "is set from the URL the ingestor reports" do
      document = ingest_document_with_public_url("https://example.com/post")

      expect(document.public_url).to eq("https://example.com/post")
    end

    it "is nil, without failing ingestion, when the URL is invalid" do
      document = ingest_document_with_public_url("not a url")

      expect(document).to be_present
      expect(document.public_url).to be_nil
    end

    it "is nil, without failing ingestion, when the URL is too long" do
      document = ingest_document_with_public_url("https://example.com/#{"a" * Document::MAX_PUBLIC_URL_LENGTH}")

      expect(document).to be_present
      expect(document.public_url).to be_nil
    end
  end

  describe "metrics" do
    it "publishes a source.pulled metric on success" do
      real_service = MetricsService.new(hub_id: source.hub_id)
      allow(MetricsService).to receive(:new).with(hub_id: source.hub_id).and_return(real_service)
      allow(real_service).to receive(:measure).and_call_original
      expect(real_service).to receive(:publish_metric).with("source.pulled", kind_of(Numeric), unit: "Milliseconds")
      described_class.new.perform(source.id)
    end

    it "does not publish a source.pulled metric when the worker raises" do
      allow(source).to receive(:handler).and_raise(StandardError, "network error")
      allow(Source).to receive(:find_by).with(id: source.id).and_return(source)

      real_service = MetricsService.new(hub_id: source.hub_id)
      allow(MetricsService).to receive(:new).with(hub_id: source.hub_id).and_return(real_service)
      allow(real_service).to receive(:measure).and_call_original
      expect(real_service).not_to receive(:publish_metric)

      expect {
        described_class.new.perform(source.id)
      }.to raise_error(StandardError, "network error")
    end
  end

  describe "trial expiration pausing" do
    it "pauses an active source when trial has expired on free hub" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub, active: true, source_type: "website")
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)

      described_class.new.perform(source.id)

      expect(source.reload.active).to eq(false)
    end

    it "pauses an active source when trial has expired on free_unrestricted hub" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub, active: true, source_type: "website")
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)

      described_class.new.perform(source.id)

      expect(source.reload.active).to eq(false)
    end

    it "does not pause source on premium hub" do
      hub = create(:hub, plan: :enterprise)
      source = create(:source, hub: hub, active: true, source_type: "website")

      expect {
        described_class.new.perform(source.id)
      }.to change(Document, :count).by(1)

      expect(source.reload.active).to eq(true)
    end

    it "does not pause source on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub, active: true, source_type: "website")

      expect {
        described_class.new.perform(source.id)
      }.to change(Document, :count).by(1)

      expect(source.reload.active).to eq(true)
    end

    it "does not create documents when pausing due to expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub, active: true, source_type: "website")
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)

      expect {
        described_class.new.perform(source.id)
      }.not_to change(Document, :count)
    end

    it "does not update already-paused source on expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      source = create(:source, hub: hub, active: false, source_type: "website")
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)

      expect(source).not_to receive(:update!)

      described_class.new.perform(source.id)
    end
  end
end
