require "rails_helper"
require "rake"

RSpec.describe "assign_public_url_to_documents" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("assign_public_url_to_documents")
  end

  after do
    Rake::Task["assign_public_url_to_documents"].reenable
  end

  def run_task
    Rake::Task["assign_public_url_to_documents"].invoke
  end

  def create_document(source_type, metadata, **attrs)
    source = (source_type == "wordpress_api") ? create(:source, :wordpress_api) : create(:source, source_type: source_type)
    create(:document, source: source, metadata: metadata, **attrs)
  end

  it "copies the metadata url into public_url for documents from public sources" do
    documents = ["website", "rss_feed", "json_api", "wordpress_api"].map do |source_type|
      create_document(source_type, {"url" => "https://example.com/#{source_type}"})
    end

    run_task

    expect(documents.map { |document| document.reload.public_url }).to eq([
      "https://example.com/website",
      "https://example.com/rss_feed",
      "https://example.com/json_api",
      "https://example.com/wordpress_api"
    ])
  end

  it "leaves public_url nil when the url is missing or invalid" do
    missing = create_document("website", nil)
    invalid = create_document("rss_feed", {"url" => "not a url"})

    run_task

    expect(missing.reload.public_url).to be_nil
    expect(invalid.reload.public_url).to be_nil
  end

  it "ignores documents from sources that are not public, even when their metadata has a url" do
    drive = create_document("google_drive_folder", {"url" => "https://example.com/drive"})
    uploaded = create_document("uploaded_files", {"url" => "https://example.com/uploaded"})

    run_task

    expect(drive.reload.public_url).to be_nil
    expect(uploaded.reload.public_url).to be_nil
  end

  it "does not overwrite an existing public_url" do
    document = create_document("website", {"url" => "https://example.com/from-metadata"}, public_url: "https://example.com/from-user")

    run_task

    expect(document.reload.public_url).to eq("https://example.com/from-user")
  end

  it "keeps updated_at" do
    document = create_document("website", {"url" => "https://example.com/page"})
    document.update_columns(updated_at: 1.year.ago)

    run_task

    expect(document.reload.updated_at).to be < 1.day.ago
  end
end
