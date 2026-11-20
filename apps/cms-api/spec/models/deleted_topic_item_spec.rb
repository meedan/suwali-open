require "rails_helper"

RSpec.describe DeletedTopicItem, type: :model do
  it "is valid with valid attributes" do
    expect(build(:deleted_topic_item)).to be_valid
  end

  it "records a topic removed from an item only once" do
    deleted_topic_item = create(:deleted_topic_item)

    duplicate = build(:deleted_topic_item, topic: deleted_topic_item.topic, item: deleted_topic_item.item)

    expect(duplicate).not_to be_valid
  end

  it "allows the same topic to be recorded as removed from different items" do
    deleted_topic_item = create(:deleted_topic_item)

    removal_from_other_item = build(:deleted_topic_item, topic: deleted_topic_item.topic, item: create(:notebook, hub: deleted_topic_item.topic.hub))

    expect(removal_from_other_item).to be_valid
  end
end
