require "rails_helper"

RSpec.describe TopicItem, type: :model do
  it "is valid with valid attributes" do
    expect(build(:topic_item)).to be_valid
  end

  it "delegates hub to the topic" do
    topic = create(:topic)
    topic_item = build(:topic_item, topic: topic)
    expect(topic_item.hub).to eq(topic.hub)
  end

  it "can tag each allowed item type" do
    hub = create(:hub)
    topic = create(:topic, hub: hub)
    items = {
      "Document" => create(:document, source: create(:source, hub: hub)),
      "Contribution" => create(:contribution, hub: hub),
      "Notebook" => create(:notebook, hub: hub),
      "Message" => create(:message, :outgoing, conversation: create(:conversation, hub: hub))
    }
    items.each do |type, item|
      topic_item = build(:topic_item, topic: topic, item: item)
      expect(topic_item).to be_valid, "expected #{type} to be a valid topic item"
      expect(topic_item.item_type).to eq(type)
    end
  end

  it "enqueues a subscription notification when a public-source document is tagged" do
    document = create(:document, source: create(:source, source_type: :rss_feed))
    topic = create(:topic, hub: document.hub)

    expect {
      create(:topic_item, topic: topic, item: document)
    }.to change(TopicSubscriptionNotificationWorker.jobs, :size).by(1)
  end

  it "does not enqueue a notification when created within without_notifications" do
    document = create(:document, source: create(:source, source_type: :rss_feed))
    topic = create(:topic, hub: document.hub)

    expect {
      TopicItem.without_notifications do
        create(:topic_item, topic: topic, item: document)
      end
    }.not_to change(TopicSubscriptionNotificationWorker.jobs, :size)
  end

  it "does not enqueue a notification for a record marked to skip them, even when it is committed later" do
    document = create(:document, source: create(:source, source_type: :rss_feed))
    topic = create(:topic, hub: document.hub)

    expect {
      TopicItem.create!(topic: topic, item: document, skip_notifications: true)
    }.not_to change(TopicSubscriptionNotificationWorker.jobs, :size)
  end

  it "resumes enqueuing notifications after without_notifications returns" do
    document = create(:document, source: create(:source, source_type: :rss_feed))
    topic = create(:topic, hub: document.hub)
    other_topic = create(:topic, hub: document.hub)

    TopicItem.without_notifications do
      create(:topic_item, topic: topic, item: document)
    end

    expect {
      create(:topic_item, topic: other_topic, item: document)
    }.to change(TopicSubscriptionNotificationWorker.jobs, :size).by(1)
  end

  it "does not enqueue for items that never produce notifications" do
    hub = create(:hub)
    topic = create(:topic, hub: hub)
    private_document = create(:document, source: create(:source, hub: hub, source_type: :uploaded_files))
    notebook = create(:notebook, hub: hub)

    expect {
      create(:topic_item, topic: topic, item: private_document)
      create(:topic_item, topic: topic, item: notebook)
    }.not_to change(TopicSubscriptionNotificationWorker.jobs, :size)
  end

  it "serializes to its id, its topic id and the topic name" do
    topic = create(:topic, name: "Climate")
    topic_item = create(:topic_item, topic: topic, item: create(:notebook, hub: topic.hub))
    expect(topic_item.as_json).to eq({id: topic_item.id, topic_id: topic.id, name: "Climate"})
  end

  it "rejects item types that are not allowed" do
    topic_item = build(:topic_item, item: create(:conversation))
    expect(topic_item).not_to be_valid
    expect(topic_item.errors[:item_type]).to be_present
  end

  it "rejects an item that belongs to a different hub than the topic" do
    topic = create(:topic)
    document = create(:document) # in its own, different hub
    topic_item = build(:topic_item, topic: topic, item: document)
    expect(topic_item).not_to be_valid
    expect(topic_item.errors[:item]).to be_present
  end

  it "does not allow the same item to be tagged twice with the same topic" do
    topic = create(:topic)
    document = create(:document, source: create(:source, hub: topic.hub))
    create(:topic_item, topic: topic, item: document)
    duplicate = build(:topic_item, topic: topic, item: document)
    expect(duplicate).not_to be_valid
  end

  it "allows the same item to be tagged with different topics" do
    hub = create(:hub)
    document = create(:document, source: create(:source, hub: hub))
    create(:topic_item, topic: create(:topic, hub: hub), item: document)
    other = build(:topic_item, topic: create(:topic, hub: hub), item: document)
    expect(other).to be_valid
  end

  describe ".of_items" do
    it "returns the topic items of the items in the relation, and not of other items or of other types" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      source = create(:source, hub: hub)
      listed = create(:document, source: source)
      unlisted = create(:document, source: source)
      notebook = create(:notebook, hub: hub)
      wanted = create(:topic_item, topic: topic, item: listed)
      create(:topic_item, topic: topic, item: unlisted)
      create(:topic_item, topic: topic, item: notebook)

      expect(TopicItem.of_items(Document.where(id: listed.id))).to contain_exactly(wanted)
    end
  end

  describe "#destroy" do
    it "records the removal of the topic from the item, whatever its type" do
      hub = create(:hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub)]
      topic_items = items.map { |item| create(:topic_item, topic: create(:topic, hub: hub), item: item) }

      topic_items.each(&:destroy!)

      topic_items.each do |topic_item|
        expect(DeletedTopicItem.where(topic: topic_item.topic, item: topic_item.item)).to exist, "expected #{topic_item.item_type} to record the removal"
      end
    end

    it "does not record a removal when the topic is destroyed" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| create(:topic_item, topic: topic, item: item) }

      topic.destroy!

      expect(DeletedTopicItem.count).to eq(0)
    end

    it "does not record a removal when the item is destroyed, whatever its type" do
      hub = create(:hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| create(:topic_item, topic: create(:topic, hub: hub), item: item) }

      items.each(&:destroy!)

      expect(DeletedTopicItem.count).to eq(0)
    end
  end

  describe "#create" do
    it "clears the recorded removal of the topic from the item, whatever its type" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| create(:deleted_topic_item, topic: topic, item: item) }

      items.each { |item| create(:topic_item, topic: topic, item: item) }

      expect(DeletedTopicItem.count).to eq(0)
    end

    it "keeps the recorded removal of the topic from another type of item with the same id" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      document = create(:document, source: create(:source, hub: hub))
      notebook = create(:notebook, hub: hub, id: document.id)
      create(:deleted_topic_item, topic: topic, item: document)

      create(:topic_item, topic: topic, item: notebook)

      expect(DeletedTopicItem.where(topic: topic, item: document)).to exist
    end
  end

  describe "syncing topics to the Knowledge Service" do
    def synced_items(hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub, published: true)]
      items.each { |item| item.update_columns(sync_status: :complete) }
    end

    it "enqueues a sync when a user adds a topic, whatever the type of item" do
      hub = create(:hub)
      user = create(:user)
      items = synced_items(hub)

      items.each do |item|
        expect {
          create(:topic_item, topic: create(:topic, hub: hub), item: item, added_by: user)
        }.to change { sync_topics_jobs.size }.by(1), "expected #{item.class} to enqueue a sync"
      end
    end

    it "enqueues a sync when a user removes a topic, whatever the type of item" do
      hub = create(:hub)
      topic_items = synced_items(hub).map { |item| create(:topic_item, topic: create(:topic, hub: hub), item: item) }

      topic_items.each do |topic_item|
        expect { topic_item.destroy! }.to change { sync_topics_jobs.size }.by(1), "expected #{topic_item.item_type} to enqueue a sync"
      end
    end

    it "does not enqueue a sync when a topic is added by the Knowledge Service suggestions" do
      hub = create(:hub)
      items = synced_items(hub)

      expect {
        items.each { |item| create(:topic_item, topic: create(:topic, hub: hub), item: item) }
      }.not_to change { sync_topics_jobs.size }
    end

    it "does not enqueue a sync when the suggestions replace the topics of an item" do
      hub = create(:hub)
      _document, contribution, _notebook = synced_items(hub)
      create(:topic_item, topic: create(:topic, hub: hub, name: "Climate"), item: contribution)

      expect {
        contribution.assign_topic_names(["Elections"])
      }.not_to change { sync_topics_jobs.size }
    end

    it "enqueues a sync for each item when the topic is destroyed" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      items = synced_items(hub)
      items.each { |item| create(:topic_item, topic: topic, item: item) }

      expect { topic.destroy! }.to change { sync_topics_jobs.size }.by(3)

      expect(sync_topics_jobs.last(3).map { |job| job["args"].last }).to match_array(items.map { |item| "#{item.class.name}/#{item.id}" })
    end

    it "does not enqueue a sync when the hub is destroyed" do
      hub = create(:hub)
      topic = create(:topic, hub: hub)
      synced_items(hub).each { |item| create(:topic_item, topic: topic, item: item) }

      expect { hub.destroy! }.not_to change { sync_topics_jobs.size }
    end

    it "does not enqueue a sync when the item is destroyed" do
      hub = create(:hub)
      synced_items(hub).each do |item|
        create(:topic_item, topic: create(:topic, hub: hub), item: item)

        expect { item.destroy! }.not_to change { sync_topics_jobs.size }
      end
    end

    it "does not enqueue a sync for a message" do
      hub = create(:hub)
      message = create(:message, :outgoing, conversation: create(:conversation, hub: hub))

      expect {
        create(:topic_item, topic: create(:topic, hub: hub), item: message, added_by: create(:user))
      }.not_to change { sync_topics_jobs.size }
    end

    it "does not enqueue a sync when the item has not finished syncing" do
      hub = create(:hub)
      contribution = create(:contribution, hub: hub)

      expect {
        create(:topic_item, topic: create(:topic, hub: hub), item: contribution, added_by: create(:user))
      }.not_to change { sync_topics_jobs.size }
    end
  end
end
