require "rails_helper"

RSpec.describe HubPreloadWorker, type: :worker do
  # Not the factory's default: these examples need the source the hub creation makes in the foreground
  let(:hub) { create(:hub, skip_data_preload: false) }
  let(:url) { "https://docs.google.com/document/d/abc123/export?format=pdf" }
  let(:pdf_body) { "%PDF-1.4 fake pdf content" }

  def stub_http_client
    client = instance_double(SourceIngestors::HttpClient)
    allow(SourceIngestors::HttpClient).to receive(:new).and_return(client)
    client
  end

  def stub_response(code: 200, body: pdf_body, content_type: "application/pdf")
    response = SourceIngestors::HttpClient::Response.new(code, "OK", body, content_type)
    allow(stub_http_client).to receive(:get).with(url).and_return(response)
    response
  end

  before do
    ENV["PRELOADED_PDF_DOCUMENT_URL"] = url
    WebMock.disable_net_connect!(allow: [/silo/, /localhost/]) # the document's file is attached for real
  end

  after do
    ENV.delete("PRELOADED_PDF_DOCUMENT_URL")
  end

  it "fetches the document with the hub's crawler User-Agent" do
    stub_response

    described_class.new.perform(hub.id)

    expect(SourceIngestors::HttpClient).to have_received(:new)
      .with(user_agent: "Suwali/1.0 (Hub #{hub.id}; +https://suwali.io)")
  end

  it "creates a preloaded source with the document and its file" do
    stub_response

    described_class.new.perform(hub.id)

    source = hub.sources.last
    expect(source.preloaded).to be true
    expect(source.source_type).to eq("uploaded_files")
    expect(source.name).to eq("About Suwali")

    document = source.documents.last
    expect(document.title).to eq("Suwali FAQ")
    expect(document.document_type).to eq("pdf")
    expect(document.file).to be_attached
    expect(document.file.download).to eq(pdf_body)
    expect(document.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_LOW)
  end

  # The source normally comes from the hub creation; the worker only creates it for hubs that predate
  # that, or that had it deleted
  it "recreates a missing source, in the locale the hub was created with" do
    stub_response
    hub.sources.destroy_all
    allow(I18n).to receive(:t).and_call_original
    allow(I18n).to receive(:t).with(:preloaded_source_title) { I18n.locale.to_s }

    described_class.new.perform(hub.id, "pt")

    expect(hub.sources.reload.where(preloaded: true).count).to eq(1)
    expect(hub.sources.last.name).to eq("pt")
  end

  it "does nothing when no URL is configured" do
    ENV.delete("PRELOADED_PDF_DOCUMENT_URL")

    described_class.new.perform(hub.id)

    expect(hub.sources.reload).to be_empty
  end

  it "does not recreate a source deleted while the download was still running" do
    stub_response
    hub.sources.find_by(preloaded: true).destroy_async!

    described_class.new.perform(hub.id)

    expect(hub.sources.reload.map(&:deleted?)).to eq([true])
    expect(Document.joins(:source).where(sources: {hub_id: hub.id}).count).to eq(0)
  end

  it "does nothing when the hub does not exist" do
    stub_http_client

    described_class.new.perform(999999)

    expect(SourceIngestors::HttpClient).not_to have_received(:new)
  end

  it "does not create a second preloaded source when it already ran" do
    stub_response

    described_class.new.perform(hub.id)
    described_class.new.perform(hub.id)

    expect(hub.sources.where(preloaded: true).count).to eq(1)
  end

  it "enqueues the ingestion itself instead of leaving it to the delayed one" do
    stub_response
    KnowledgeServiceWorker.clear

    described_class.new.perform(hub.id)

    document = hub.sources.last.documents.last
    expect(KnowledgeServiceWorker.jobs.size).to eq(1)
    job = KnowledgeServiceWorker.jobs.first
    expect(job["args"]).to eq(["ingest_document", document.id])
    expect(job["at"]).to be_nil # not delayed: the file is already attached
  end

  it "attaches the file and enqueues the ingestion on a retry after the attachment failed" do
    stub_response
    allow_any_instance_of(ActiveStorage::Attached::One).to receive(:attach).and_raise("S3 is down")
    allow(LogService).to receive(:log)
    expect { described_class.new.perform(hub.id) }.to raise_error("S3 is down")
    expect(LogService).to have_received(:log).with(:error, "HubPreloadWorker", /S3 is down/)

    allow_any_instance_of(ActiveStorage::Attached::One).to receive(:attach).and_call_original
    KnowledgeServiceWorker.clear
    described_class.new.perform(hub.id)

    expect(hub.sources.where(preloaded: true).count).to eq(1)
    document = hub.sources.last.documents.last
    expect(hub.sources.last.documents.count).to eq(1)
    expect(document.file).to be_attached
    expect(KnowledgeServiceWorker.jobs.map { |j| j["args"] }).to eq([["ingest_document", document.id]])
    expect(document.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_LOW)
  end

  it "logs an error and creates nothing when the response is not a PDF" do
    stub_response(body: "<html>Sign in</html>", content_type: "text/html")
    expect(LogService).to receive(:log).with(:error, "HubPreloadWorker", /unexpected content type/)

    described_class.new.perform(hub.id)

    expect(hub.sources.reload).to be_empty
  end

  it "logs an error and creates nothing when the body is not a PDF despite the content type" do
    stub_response(body: "<html>Sign in</html>")
    expect(LogService).to receive(:log).with(:error, "HubPreloadWorker", /not a PDF/)

    described_class.new.perform(hub.id)

    expect(hub.sources.reload).to be_empty
  end

  it "logs an error and creates nothing when the request fails" do
    stub_response(code: 404, body: "", content_type: "")
    expect(LogService).to receive(:log).with(:error, "HubPreloadWorker", /HTTP 404/)

    described_class.new.perform(hub.id)

    expect(hub.sources.reload).to be_empty
  end

  it "logs an error and re-raises so Sidekiq retries when the download fails" do
    allow(stub_http_client).to receive(:get)
      .and_raise(SourceIngestors::HttpClient::FetchFailedError.new("connection reset"))
    expect(LogService).to receive(:log).with(:error, "HubPreloadWorker", /connection reset/)

    expect {
      described_class.new.perform(hub.id)
    }.to raise_error(SourceIngestors::HttpClient::FetchFailedError)

    # Kept, unlike an invalid response: the retry reuses it
    expect(hub.sources.where(preloaded: true).count).to eq(1)
    expect(hub.sources.last.documents).to be_empty
  end
end
