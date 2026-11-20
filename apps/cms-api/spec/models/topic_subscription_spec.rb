require "rails_helper"

RSpec.describe TopicSubscription, type: :model do
  it "is valid with valid attributes" do
    expect(build(:topic_subscription)).to be_valid
  end

  it "delegates hub to the topic" do
    topic = create(:topic)
    subscription = build(:topic_subscription, topic: topic)
    expect(subscription.hub).to eq(topic.hub)
  end

  it "rejects an external user that belongs to a different hub than the topic" do
    topic = create(:topic)
    external_user = create(:external_user) # in its own, different hub
    subscription = build(:topic_subscription, topic: topic, external_user: external_user)
    expect(subscription).not_to be_valid
    expect(subscription.errors[:external_user]).to be_present
  end

  it "does not allow a user to subscribe to the same topic twice" do
    hub = create(:hub)
    topic = create(:topic, hub: hub)
    external_user = create(:external_user, hub: hub)
    create(:topic_subscription, topic: topic, external_user: external_user)
    duplicate = build(:topic_subscription, topic: topic, external_user: external_user)
    expect(duplicate).not_to be_valid
  end

  it "is exposed through the external user's subscribed topics" do
    hub = create(:hub)
    topic = create(:topic, hub: hub)
    external_user = create(:external_user, hub: hub)
    create(:topic_subscription, topic: topic, external_user: external_user)

    expect(external_user.subscribed_topics).to eq([topic])
  end
end
