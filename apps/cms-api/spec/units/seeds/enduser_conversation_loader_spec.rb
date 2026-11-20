require_relative "../../unit_spec_helper"
require_relative "../../../db/seeds/enduser_conversation_loader"

RSpec.describe EnduserConversationLoader do
  def loader(data, hub: double(id: 7))
    described_class.new(hub, data)
  end

  def hub_already_holding(message_ids)
    double(id: 7, contributions: double(where: double(pluck: message_ids)))
  end

  def hub_with_local_contributions(pairs)
    double(id: 7, contributions: double(where: double(pluck: pairs)))
  end

  def stub_sync_statuses
    stub_const("Contribution", double(sync_statuses: ActiveSupport::HashWithIndifferentAccess.new("pending" => 0, "error" => 1, "complete" => 2)))
  end

  def message(id, reply_to_id: nil, cluster_id: nil)
    {"id" => id, "message_cluster_id" => cluster_id, "reply_to_id" => reply_to_id}
  end

  describe "#external_user_rows" do
    it "keeps the source id so the snapshot's own foreign keys still resolve" do
      rows = loader({"external_users" => [{"id" => 500, "hub_id" => 1}]}).send(:external_user_rows)

      expect(rows.first).to include("id" => 500)
    end

    it "rewrites hub_id to the target hub" do
      rows = loader({"external_users" => [{"id" => 500, "hub_id" => 1}]}).send(:external_user_rows)

      expect(rows.first).to include("hub_id" => 7)
    end
  end

  describe "#conversation_rows" do
    it "rewrites hub_id and keeps the source id" do
      rows = loader({"conversations" => [{"id" => 600, "hub_id" => 1}]}).send(:conversation_rows)

      expect(rows.first).to include("id" => 600, "hub_id" => 7)
    end
  end

  describe "#message_rows" do
    it "always clears the cluster, which is never exported" do
      rows = loader({"messages" => [message(1, cluster_id: 99)]}).send(:message_rows)

      expect(rows.first["message_cluster_id"]).to be_nil
    end

    it "keeps a reply pointing at a message inside the snapshot" do
      rows = loader({"messages" => [message(1), message(2, reply_to_id: 1)]}).send(:message_rows)

      expect(rows.last["reply_to_id"]).to eq(1)
    end

    it "clears a reply pointing outside the snapshot" do
      rows = loader({"messages" => [message(1, reply_to_id: 8_000)]}).send(:message_rows)

      expect(rows.first["reply_to_id"]).to be_nil
    end
  end

  describe "#data_source_item_rows" do
    def data_with_items
      {"messages" => [message(1)], "message_data_source_items" => [{"id" => 10, "message_id" => 1}, {"id" => 11, "message_id" => 9_000}]}
    end

    it "drops the source id so it cannot overwrite an unrelated local row" do
      rows = loader(data_with_items).send(:data_source_item_rows)

      expect(rows.first).not_to have_key("id")
    end

    it "skips items whose message is not in the snapshot" do
      rows = loader(data_with_items).send(:data_source_item_rows)

      expect(rows.map { |row| row["message_id"] }).to eq([1])
    end

    def data_with_citations
      {
        "messages" => [message(1)],
        "contributions" => [{"id" => 144, "message_id" => 1, "active" => true}],
        "message_data_source_items" => [
          {"id" => 10, "message_id" => 1, "item_type" => "Contribution", "item_id" => 144},
          {"id" => 11, "message_id" => 1, "item_type" => "Contribution", "item_id" => 999},
          {"id" => 12, "message_id" => 1, "item_type" => "Document", "item_id" => 20_748}
        ]
      }
    end

    it "remaps a contribution citation onto the local contribution" do
      rows = loader(data_with_citations, hub: hub_with_local_contributions([[1, 83]])).send(:data_source_item_rows)

      expect(rows.find { |row| row["item_type"] == "Contribution" }["item_id"]).to eq(83)
    end

    it "drops a contribution citation it cannot resolve, rather than pointing it at an unrelated row" do
      rows = loader(data_with_citations, hub: hub_with_local_contributions([[1, 83]])).send(:data_source_item_rows)

      expect(rows.count { |row| row["item_type"] == "Contribution" }).to eq(1)
    end

    it "leaves a document citation dangling, since documents are never exported" do
      rows = loader(data_with_citations, hub: hub_with_local_contributions([[1, 83]])).send(:data_source_item_rows)

      expect(rows.find { |row| row["item_type"] == "Document" }["item_id"]).to eq(20_748)
    end
  end

  describe "#mapped_contribution_rows" do
    def contribution_data
      {
        "messages" => [message(1), message(2)],
        "contributions" => [
          {"id" => 50, "message_id" => 1, "active" => true, "last_sync_error_code" => "NO_TEXT_FOUND"},
          {"id" => 51, "message_id" => 2, "active" => false},
          {"id" => 52, "message_id" => 9_000, "active" => true}
        ]
      }
    end

    def mapped_rows
      loader(contribution_data).send(:mapped_contribution_rows)
    end

    it "leaves an active contribution pending, for the caller to queue" do
      stub_sync_statuses

      expect(mapped_rows.find { |row| row["message_id"] == 1 }["sync_status"]).to eq(0)
    end

    it "marks a paused contribution complete, since nothing will ingest it" do
      stub_sync_statuses

      expect(mapped_rows.find { |row| row["message_id"] == 2 }["sync_status"]).to eq(2)
    end

    it "drops the source id and rewrites hub_id" do
      stub_sync_statuses

      expect(mapped_rows.first).not_to have_key("id")
      expect(mapped_rows.first["hub_id"]).to eq(7)
    end

    it "clears a sync error carried over from the source" do
      stub_sync_statuses

      expect(mapped_rows.first["last_sync_error_code"]).to be_nil
    end

    it "skips a contribution whose message is not in the snapshot" do
      stub_sync_statuses

      expect(mapped_rows.map { |row| row["message_id"] }).to eq([1, 2])
    end
  end

  describe "#reject_already_loaded" do
    it "skips messages that already carry a contribution" do
      rows = [{"message_id" => 1}, {"message_id" => 2}]

      remaining = loader({}, hub: hub_already_holding([2])).send(:reject_already_loaded, rows)

      expect(remaining).to eq([{"message_id" => 1}])
    end
  end

  context "when a section is absent from the snapshot" do
    it "treats it as empty rather than raising" do
      expect(loader({}).send(:external_user_rows)).to eq([])
      expect(loader({}).send(:message_rows)).to eq([])
      expect(loader({}).send(:data_source_item_rows)).to eq([])
    end
  end
end
