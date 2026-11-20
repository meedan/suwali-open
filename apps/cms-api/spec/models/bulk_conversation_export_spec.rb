require "rails_helper"

RSpec.describe BulkConversationExport, type: :model do
  it "starts as pending" do
    expect(create(:bulk_conversation_export)).to be_pending
  end

  it "enqueues the export worker once created" do
    export = nil

    expect { export = create(:bulk_conversation_export) }.to change(BulkConversationExportWorker.jobs, :size).by(1)
    expect(BulkConversationExportWorker.jobs.last["args"]).to eq([export.id])
  end

  it "requires a hub and a requesting user" do
    export = build(:bulk_conversation_export, hub: nil, requested_by: nil)

    expect(export).not_to be_valid
    expect(export.errors.attribute_names).to include(:hub, :requested_by)
  end

  it "allows only one pending export per hub" do
    export = create(:bulk_conversation_export)

    expect { create(:bulk_conversation_export, hub: export.hub) }.to raise_error(ActiveRecord::RecordNotUnique)
  end

  it "allows a pending export while another hub has one pending" do
    create(:bulk_conversation_export)

    expect { create(:bulk_conversation_export) }.not_to raise_error
  end

  it "allows a pending export once the hub's previous one is finished" do
    export = create(:bulk_conversation_export, status: :ready)

    expect { create(:bulk_conversation_export, hub: export.hub) }.not_to raise_error
  end

  it "is destroyed with its hub" do
    export = create(:bulk_conversation_export)

    expect { export.hub.destroy! }.to change(BulkConversationExport, :count).by(-1)
  end

  it "is destroyed with its requesting user" do
    export = create(:bulk_conversation_export)

    expect { export.requested_by.destroy! }.to change(BulkConversationExport, :count).by(-1)
  end

  describe ".expired_by_ttl" do
    it "returns exports created before the TTL, not newer ones" do
      old_export = create(:bulk_conversation_export, created_at: (BulkConversationExport::TTL + 1.minute).ago)
      create(:bulk_conversation_export, created_at: 1.hour.ago)

      expect(BulkConversationExport.expired_by_ttl).to contain_exactly(old_export)
    end
  end

  describe "#conversations" do
    it "returns the hub's non-deleted conversations, not other hubs' ones" do
      export = create(:bulk_conversation_export)
      conversation = create(:conversation, hub: export.hub)
      create(:conversation, hub: export.hub, deleted_at: Time.current)
      create(:conversation)

      expect(export.conversations).to contain_exactly(conversation)
    end

    it "keeps only the latest MAX_CONVERSATIONS by id" do
      stub_const("BulkConversationExport::MAX_CONVERSATIONS", 2)
      export = create(:bulk_conversation_export)
      create(:conversation, hub: export.hub)
      latest = create_list(:conversation, 2, hub: export.hub)

      expect(export.conversations).to match_array(latest)
    end
  end

  describe "#download_url" do
    def ready_export(created_at:)
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      create(:bulk_conversation_export, :ready, created_at: created_at)
    end

    it "returns a presigned attachment URL that expires with the export" do
      export = ready_export(created_at: 1.hour.ago)

      url = URI.parse(export.download_url)

      params = Rack::Utils.parse_query(url.query)
      expect(params["X-Amz-Expires"].to_i).to be_within(5).of(3.hours.to_i)
      expect(params["response-content-disposition"]).to start_with("attachment")
    end

    it "signs the URL with the public endpoint, not the one the container uploads to" do
      export = ready_export(created_at: 1.hour.ago)

      expect(URI.parse(export.download_url).host).to eq("localhost")
    end

    it "returns nil once the TTL has passed, even before cleanup marks it expired" do
      export = ready_export(created_at: (BulkConversationExport::TTL + 1.minute).ago)

      expect(export.download_url).to be_nil
    end

    it "returns nil while the export is pending" do
      expect(create(:bulk_conversation_export).download_url).to be_nil
    end
  end
end
