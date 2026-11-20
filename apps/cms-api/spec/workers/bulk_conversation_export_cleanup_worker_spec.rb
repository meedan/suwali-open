require "rails_helper"

RSpec.describe BulkConversationExportCleanupWorker do
  def ready_export(created_at:)
    WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
    create(:bulk_conversation_export, :ready, created_at: created_at)
  end

  def past_ttl
    (BulkConversationExport::TTL + 1.minute).ago
  end

  it "purges the file of a ready export past the TTL and marks it expired" do
    export = ready_export(created_at: past_ttl)

    described_class.new.perform

    export.reload
    expect(export).to be_expired
    expect(export.file).not_to be_attached
  end

  it "keeps a ready export within the TTL" do
    export = ready_export(created_at: 1.hour.ago)

    described_class.new.perform

    export.reload
    expect(export).to be_ready
    expect(export.file).to be_attached
  end

  it "marks a pending export past the TTL as failed" do
    export = create(:bulk_conversation_export, created_at: past_ttl)

    described_class.new.perform

    expect(export.reload).to be_failed
  end

  it "keeps a pending export within the TTL" do
    export = create(:bulk_conversation_export, created_at: 1.hour.ago)

    described_class.new.perform

    expect(export.reload).to be_pending
  end
end
