require "rails_helper"
require Rails.root.join("db/seeds/topic_subscription_seeder")

RSpec.describe TopicSubscriptionSeeder do
  let(:hub) { create(:hub) }

  def add_users(count, target_hub = hub)
    Array.new(count) { create(:external_user, hub: target_hub, external_id: SecureRandom.hex) }
  end

  def add_topics(count, target_hub = hub)
    Array.new(count) { create(:topic, hub: target_hub) }
  end

  describe "#seed!" do
    it "subscribes every external user in the hub" do
      users = add_users(3)
      add_topics(3)

      described_class.new(hub).seed!

      subscribed = TopicSubscription.where(external_user: users).distinct.count(:external_user_id)
      expect(subscribed).to eq(users.size)
    end

    it "subscribes everyone to a shared set of topics" do
      users = add_users(4)
      add_topics(30)

      described_class.new(hub).seed!

      subscribers_per_topic = TopicSubscription.where(topic: hub.topics).group(:topic_id).count.values
      expect(subscribers_per_topic.count(users.size)).to be >= described_class::POPULAR_TOPICS
    end

    it "returns the number of subscriptions it wrote" do
      add_users(2)
      add_topics(3) # fewer than TOPICS_PER_USER, so every user takes every topic

      expect(described_class.new(hub).seed!).to eq(6)
    end

    it "leaves another hub's topics alone" do
      add_users(2)
      add_topics(3)
      other_hub = create(:hub)
      add_topics(3, other_hub)
      add_users(2, other_hub)

      described_class.new(hub).seed!

      expect(TopicSubscription.joins(:topic).where(topics: {hub_id: other_hub.id})).to be_empty
    end

    context "when the hub's topics already have subscriptions" do
      it "writes nothing and returns 0" do
        users = add_users(2)
        topic = add_topics(3).first
        create(:topic_subscription, topic: topic, external_user: users.first)

        seeded = nil
        expect { seeded = described_class.new(hub).seed! }.not_to change(TopicSubscription, :count)

        expect(seeded).to eq(0)
      end
    end

    context "when the hub has no topics" do
      it "returns 0" do
        add_users(2)

        expect(described_class.new(hub).seed!).to eq(0)
      end
    end

    context "when the hub has no external users" do
      it "returns 0" do
        add_topics(3)

        expect(described_class.new(hub).seed!).to eq(0)
      end
    end
  end
end
