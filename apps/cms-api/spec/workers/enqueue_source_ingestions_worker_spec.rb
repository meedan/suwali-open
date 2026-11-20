require "rails_helper"

RSpec.describe EnqueueSourceIngestionsWorker, type: :worker do
  let!(:hub) { create(:hub, invite_code: "CAT123") }
  let!(:active_source1) { create(:source, hub: hub, active: true) }
  let!(:active_source2) { create(:source, hub: hub, active: true) }
  let!(:inactive_source) { create(:source, hub: hub, active: false) }
  let!(:in_progress_source) { create(:source, hub: hub, active: true).tap { |s| s.update_columns(ingestion_started_at: 10.minutes.ago) } }
  let!(:stale_source) { create(:source, hub: hub, active: true).tap { |s| s.update_columns(ingestion_started_at: 25.hours.ago) } }
  let!(:uploaded_files_source) { create(:source, hub: hub, source_type: :uploaded_files, config: {}, active: true) }

  it "enqueues ingestion workers only for active sources" do
    expect(SourceIngestionWorker).to receive(:perform_async).with(active_source1.id)
    expect(SourceIngestionWorker).to receive(:perform_async).with(active_source2.id)
    expect(SourceIngestionWorker).not_to receive(:perform_async).with(inactive_source.id)

    described_class.new.perform
  end

  it "does not enqueue ingestion for sources already in progress" do
    allow(SourceIngestionWorker).to receive(:perform_async)
    expect(SourceIngestionWorker).not_to receive(:perform_async).with(in_progress_source.id)

    described_class.new.perform
  end

  it "re-enqueues sources with a stale ingestion_started_at" do
    allow(SourceIngestionWorker).to receive(:perform_async)
    expect(SourceIngestionWorker).to receive(:perform_async).with(stale_source.id)

    described_class.new.perform
  end

  it "does not enqueue ingestion for uploaded_files sources" do
    allow(SourceIngestionWorker).to receive(:perform_async)
    expect(SourceIngestionWorker).not_to receive(:perform_async).with(uploaded_files_source.id)

    described_class.new.perform
  end

  it "runs successfully" do
    allow(SourceIngestionWorker).to receive(:perform_async)
    expect { described_class.new.perform }.not_to raise_error
  end
end
