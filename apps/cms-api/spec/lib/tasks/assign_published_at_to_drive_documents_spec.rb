require "rails_helper"
require "rake"

RSpec.describe "assign_published_at_to_drive_documents" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("assign_published_at_to_drive_documents")
  end

  after do
    Rake::Task["assign_published_at_to_drive_documents"].reenable
  end

  # Returns what the task printed, so the progress output stays out of the rspec output
  def run_task
    original_stdout = $stdout
    $stdout = StringIO.new
    Rake::Task["assign_published_at_to_drive_documents"].invoke
    $stdout.string
  ensure
    $stdout = original_stdout
  end

  def stub_drive_handler(created_times, failures: {})
    handler = instance_double(SourceIngestors::GoogleDriveFolder)
    allow(handler).to receive(:refetch_document_data) do |data|
      external_id = data[:external_id]
      raise failures[external_id] if failures.key?(external_id)

      {date: created_times.fetch(external_id)}
    end
    allow(SourceIngestors::GoogleDriveFolder).to receive(:new).and_return(handler)
    handler
  end

  def create_drive_document(external_id, source: create(:source, source_type: "google_drive_folder"), **attrs)
    create(:document, source: source, external_id: external_id, **attrs)
  end

  it "copies the Drive created time into published_at for Drive documents without one" do
    stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1, 10)})
    document = create_drive_document("file-1")

    run_task

    expect(document.reload.published_at).to eq(Time.utc(2024, 1, 1, 10))
  end

  it "builds one Drive handler per source, not per document" do
    stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1), "file-2" => DateTime.new(2024, 1, 2), "file-3" => DateTime.new(2024, 1, 3)})
    source = create(:source, source_type: "google_drive_folder")
    create_drive_document("file-1", source: source)
    create_drive_document("file-2", source: source)
    create_drive_document("file-3")

    run_task

    expect(SourceIngestors::GoogleDriveFolder).to have_received(:new).twice
  end

  it "does not overwrite an existing published_at" do
    existing = Time.utc(2020, 5, 5, 5)
    handler = stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1)})
    document = create_drive_document("file-1", published_at: existing)

    run_task

    expect(document.reload.published_at).to eq(existing)
    expect(handler).not_to have_received(:refetch_document_data)
  end

  it "ignores documents from deleted sources" do
    handler = stub_drive_handler({})
    document = create_drive_document("file-1")
    document.source.update_columns(deleted_at: Time.current)

    run_task

    expect(document.reload.published_at).to be_nil
    expect(handler).not_to have_received(:refetch_document_data)
  end

  it "ignores documents from other source types" do
    handler = stub_drive_handler({})
    rss = create(:document, source: create(:source, source_type: "rss_feed"), external_id: "guid-1")

    run_task

    expect(rss.reload.published_at).to be_nil
    expect(handler).not_to have_received(:refetch_document_data)
  end

  it "leaves published_at nil when Drive returns no usable date" do
    stub_drive_handler({"file-1" => nil})
    document = create_drive_document("file-1")

    run_task

    expect(document.reload.published_at).to be_nil
  end

  it "keeps going when Drive fails for one document" do
    stub_drive_handler({"file-2" => DateTime.new(2024, 1, 2, 3)}, failures: {"gone" => "File gone is no longer a supported type"})
    source = create(:source, source_type: "google_drive_folder")
    failing = create_drive_document("gone", source: source)
    working = create_drive_document("file-2", source: source)

    run_task

    expect(failing.reload.published_at).to be_nil
    expect(working.reload.published_at).to eq(Time.utc(2024, 1, 2, 3))
  end

  it "skips callbacks: updated_at is kept and no Knowledge Service sync is enqueued" do
    stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1)})
    document = create_drive_document("file-1")
    document.update_columns(updated_at: 1.year.ago, sync_status: :complete)
    KnowledgeServiceWorker.clear

    run_task

    expect(document.reload.updated_at).to be < 1.day.ago
    expect(document.sync_status).to eq("complete")
    expect(KnowledgeServiceWorker.jobs).to be_empty
  end

  it "reports how many documents it will update" do
    stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1), "file-2" => DateTime.new(2024, 1, 2)})
    source = create(:source, source_type: "google_drive_folder")
    create_drive_document("file-1", source: source)
    create_drive_document("file-2", source: source)
    create_drive_document("file-3", source: source, published_at: Time.utc(2020, 1, 1))

    expect(run_task).to match(/Found 2 Google Drive document\(s\) without published_at/)
  end

  context "with progress output" do
    def create_mixed_documents
      stub_drive_handler({"file-1" => DateTime.new(2024, 1, 1), "no-date" => nil}, failures: {"gone" => "no longer a supported type"})
      source = create(:source, source_type: "google_drive_folder")
      create_drive_document("file-1", source: source)
      create_drive_document("no-date", source: source)
      create_drive_document("gone", source: source)
    end

    it "prints a dot per updated document, S per skipped one and F per failed one" do
      create_mixed_documents

      expect(run_task).to match(/\.SF/)
    end

    it "summarizes the updated, skipped and failed counts" do
      create_mixed_documents

      expect(run_task).to match(/Assigned published_at on 1 Google Drive document\(s\), skipped 1 \(no date\), failed 1/)
    end

    it "lists each failed document with its error" do
      failed_document = create_mixed_documents

      expect(run_task).to match(/Failed: #{failed_document.id} \(gone\): no longer a supported type/)
    end
  end
end
