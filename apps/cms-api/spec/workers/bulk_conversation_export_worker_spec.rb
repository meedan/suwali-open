require "rails_helper"
require "csv"

RSpec.describe BulkConversationExportWorker do
  def exported_conversation_ids(export)
    CSV.parse(export.file.download, headers: true).map { |row| row["convo_id"].to_i }.uniq
  end

  def conversation_with_message(hub)
    create(:conversation, hub: hub).tap { |conversation| create(:message, :incoming, conversation: conversation) }
  end

  it "attaches the hub's conversations as a CSV and marks the export ready" do
    WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
    export = create(:bulk_conversation_export)
    conversation = conversation_with_message(export.hub)
    conversation_with_message(create(:hub))

    described_class.new.perform(export.id)

    export.reload
    expect(export).to be_ready
    expect(export.file.filename.to_s).to eq("suwali-hub-#{export.hub_id}-conversations-export-#{Date.today}.csv")
    expect(export.file.content_type).to eq("text/csv")
    expect(exported_conversation_ids(export)).to eq([conversation.id])
  end

  it "leaves out the oldest conversations beyond MAX_CONVERSATIONS" do
    WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
    stub_const("BulkConversationExport::MAX_CONVERSATIONS", 2)
    export = create(:bulk_conversation_export)
    conversation_with_message(export.hub)
    latest = Array.new(2) { conversation_with_message(export.hub) }

    described_class.new.perform(export.id)

    expect(exported_conversation_ids(export.reload)).to eq(latest.map(&:id))
  end

  it "does nothing when the export is no longer pending" do
    export = create(:bulk_conversation_export, status: :ready)

    described_class.new.perform(export.id)

    expect(export.reload.file).not_to be_attached
  end

  it "does nothing when the export no longer exists" do
    expect { described_class.new.perform(0) }.not_to raise_error
  end

  describe "sidekiq_retries_exhausted callback" do
    it "marks the export failed and logs" do
      export = create(:bulk_conversation_export)
      allow(LogService).to receive(:log)

      described_class.sidekiq_retries_exhausted_block.call({"args" => [export.id], "jid" => "xyz789"}, StandardError.new("Error"))

      expect(export.reload).to be_failed
      expect(LogService).to have_received(:log).with(:error, "BulkConversationExportWorker", /export #{export.id}.*xyz789/)
    end
  end
end
