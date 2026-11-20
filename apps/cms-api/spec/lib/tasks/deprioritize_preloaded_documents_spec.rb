require "rails_helper"
require "rake"

RSpec.describe "knowledge_service:deprioritize_preloaded_documents" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("knowledge_service:deprioritize_preloaded_documents")
  end

  after do
    Rake::Task["knowledge_service:deprioritize_preloaded_documents"].reenable
  end

  def run_task
    Rake::Task["knowledge_service:deprioritize_preloaded_documents"].invoke
  end

  def create_preloaded_faq(**document_attrs)
    source = create(:source, preloaded: true)
    create(:document, source: source, external_id: HubPreloadWorker::DOCUMENT_EXTERNAL_ID, active: true, **document_attrs)
  end

  it "moves an active preloaded FAQ to the low tier and enqueues a re-ingestion" do
    faq = create_preloaded_faq
    faq.update_column(:sync_status, :complete)
    KnowledgeServiceWorker.clear

    run_task

    expect(faq.reload.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_LOW)
    expect(faq.sync_status).to eq("pending")
    expect(KnowledgeServiceWorker.jobs.map { |j| j["args"] }).to eq([["ingest_document", faq.id]])
  end

  it "skips a FAQ already at the low tier so re-runs do not re-ingest" do
    create_preloaded_faq(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_LOW)
    KnowledgeServiceWorker.clear

    run_task

    expect(KnowledgeServiceWorker.jobs).to be_empty
  end

  it "restores the tier when enqueueing fails so a re-run retries the document" do
    faq = create_preloaded_faq
    KnowledgeServiceWorker.clear
    allow(KnowledgeServiceWorker).to receive(:perform_async).and_raise(Redis::CannotConnectError)

    run_task

    expect(faq.reload.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
  end

  it "does not touch a normal document" do
    document = create(:document)
    KnowledgeServiceWorker.clear

    run_task

    expect(KnowledgeServiceWorker.jobs).to be_empty
    expect(document.reload.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
  end

  it "does not touch a FAQ on a soft-deleted source" do
    faq = create_preloaded_faq
    faq.source.update!(deleted_at: Time.current)
    KnowledgeServiceWorker.clear

    run_task

    expect(KnowledgeServiceWorker.jobs).to be_empty
    expect(faq.reload.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
  end

  it "does not touch an inactive FAQ" do
    faq = create_preloaded_faq(active: false)
    KnowledgeServiceWorker.clear

    run_task

    expect(KnowledgeServiceWorker.jobs).to be_empty
    expect(faq.reload.priority_tier).to eq(KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
  end
end
