require "rails_helper"

RSpec.describe Topic, type: :model do
  it "is valid with valid attributes" do
    expect(build(:topic)).to be_valid
  end

  it "requires a name" do
    topic = build(:topic, name: nil)
    expect(topic).not_to be_valid
    expect(topic.errors[:name]).to be_present
  end

  it "requires the name to be unique within a hub" do
    hub = create(:hub)
    create(:topic, hub: hub, name: "Elections")
    duplicate = build(:topic, hub: hub, name: "Elections")
    expect(duplicate).not_to be_valid
  end

  it "allows the same name in different hubs" do
    create(:topic, hub: create(:hub), name: "Elections")
    other = build(:topic, hub: create(:hub), name: "Elections")
    expect(other).to be_valid
  end

  it "destroys its topic items and subscriptions when destroyed" do
    topic = create(:topic)
    create(:topic_item, topic: topic, item: create(:notebook, hub: topic.hub))
    create(:topic_subscription, topic: topic, external_user: create(:external_user, hub: topic.hub))

    expect { topic.destroy }.to change(TopicItem, :count).by(-1).and change(TopicSubscription, :count).by(-1)
  end

  it "deletes the records of its removal from items when destroyed" do
    topic = create(:topic)
    create(:deleted_topic_item, topic: topic, item: create(:notebook, hub: topic.hub))

    expect { topic.destroy }.to change(DeletedTopicItem, :count).by(-1)
  end

  it "exposes its subscribers through topic subscriptions" do
    topic = create(:topic)
    external_user = create(:external_user, hub: topic.hub)
    create(:topic_subscription, topic: topic, external_user: external_user)

    expect(topic.subscribers).to eq([external_user])
  end
end
