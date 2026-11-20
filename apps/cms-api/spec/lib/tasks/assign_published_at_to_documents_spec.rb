require "rails_helper"
require "rake"

RSpec.describe "assign_published_at_to_documents" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("assign_published_at_to_documents")
  end

  after do
    Rake::Task["assign_published_at_to_documents"].reenable
  end

  def run_task
    Rake::Task["assign_published_at_to_documents"].invoke
  end

  def create_document(source_type, metadata, **attrs)
    create(:document, source: create(:source, source_type: source_type), metadata: metadata, **attrs)
  end

  it "copies the metadata date into published_at for RSS and JSON API documents" do
    rss = create_document("rss_feed", {"published_at" => "2024-01-01T10:00:00Z"})
    json = create_document("json_api", {"date" => "2024-02-03T04:05:06Z"})

    run_task

    expect(rss.reload.published_at).to eq(Time.utc(2024, 1, 1, 10))
    expect(json.reload.published_at).to eq(Time.utc(2024, 2, 3, 4, 5, 6))
  end

  it "leaves published_at nil when the date is missing or unparseable" do
    missing = create_document("rss_feed", nil)
    unparseable = create_document("json_api", {"date" => "not a date"})

    run_task

    expect(missing.reload.published_at).to be_nil
    expect(unparseable.reload.published_at).to be_nil
  end

  it "ignores sources whose metadata has no publication date" do
    drive = create_document("google_drive_folder", {"modified_time" => "2024-01-01T10:00:00Z"})
    website = create_document("website", {"published_at" => "2024-01-01T10:00:00Z", "date" => "2024-01-01"})

    run_task

    expect(drive.reload.published_at).to be_nil
    expect(website.reload.published_at).to be_nil
  end

  it "does not overwrite an existing published_at" do
    existing = Time.utc(2020, 5, 5, 5)
    document = create_document("rss_feed", {"published_at" => "2024-01-01T10:00:00Z"}, published_at: existing)

    run_task

    expect(document.reload.published_at).to eq(existing)
  end

  it "skips callbacks: updated_at is kept and no Knowledge Service sync is enqueued" do
    document = create_document("rss_feed", {"published_at" => "2024-01-01T10:00:00Z"})
    document.update_columns(updated_at: 1.year.ago, sync_status: :complete)
    KnowledgeServiceWorker.clear

    run_task

    expect(document.reload.updated_at).to be < 1.day.ago
    expect(document.sync_status).to eq("complete")
    expect(KnowledgeServiceWorker.jobs).to be_empty
  end
end
