require "rails_helper"

RSpec.describe MessageDataSourceItem, type: :model do
  shared_context "with message, item and message_data_source_item" do
    let(:message) { create(:message, :outgoing, metadata: {}) }
    let(:item) { create(:document, title: "Original Title") }
    let!(:message_data_source_item) { described_class.create!(message: message, item: item) }
  end

  describe "uniqueness" do
    include_context "with message, item and message_data_source_item"

    it "prevents duplicate associations for the same message" do
      duplicate = described_class.new(message: message, item: item)

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:item_id]).to be_present
    end
  end

  describe "clean up of associated records" do
    include_context "with message, item and message_data_source_item"

    it "deletes associated MessageDataSourceItems when a Message is deleted" do
      message.destroy
      expect(described_class.find_by(id: message_data_source_item.id)).to be_nil
    end

    it "does not delete associated MessageDataSourceItems when an Item is deleted" do
      item.destroy
      expect(described_class.find_by(id: message_data_source_item.id)).to be_present
    end
  end

  describe "keeps item title in sync" do
    include_context "with message, item and message_data_source_item"

    it "updates item_title when the associated item's title changes" do
      expect(message_data_source_item.item_title).to eq("Original Title")

      item.update!(title: "Updated Title")
      message_data_source_item.reload

      expect(message_data_source_item.item_title).to eq("Updated Title")
    end
  end

  describe "#is_public_source_document?" do
    let(:message) { create(:message, :outgoing, metadata: {}) }

    def mdsi_for(item)
      described_class.create!(message: message, item: item)
    end

    it "is true for an active document from a public source" do
      document = create(:document, source: create(:source, source_type: :rss_feed))
      expect(mdsi_for(document).is_public_source_document?).to be(true)
    end

    it "is false for a document from a non-public source" do
      document = create(:document, source: create(:source, source_type: :google_drive_folder))
      expect(mdsi_for(document).is_public_source_document?).to be(false)
    end

    it "is false for an inactive document from a public source" do
      document = create(:document, source: create(:source, source_type: :website), active: false)
      expect(mdsi_for(document).is_public_source_document?).to be(false)
    end

    it "is false for non-Document items" do
      contribution = create(:contribution)
      expect(mdsi_for(contribution).is_public_source_document?).to be(false)
    end
  end
end
