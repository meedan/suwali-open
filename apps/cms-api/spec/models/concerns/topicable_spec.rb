require "rails_helper"

RSpec.describe Topicable do
  describe ".tagged_with" do
    let(:hub) { create(:hub) }
    let(:source) { create(:source, hub: hub) }
    let(:climate) { hub.topics.create!(name: "Climate") }
    let(:elections) { hub.topics.create!(name: "Elections") }

    it "returns the items that have any of the topics, each once" do
      both = create(:document, source: source)
      both.topic_items.create!(topic: climate)
      both.topic_items.create!(topic: elections)
      only_climate = create(:document, source: source)
      only_climate.topic_items.create!(topic: climate)
      create(:document, source: source)

      expect(Document.tagged_with([climate.id, elections.id])).to contain_exactly(both, only_climate)
    end

    it "does not match another type of item with the same id" do
      document = create(:document, source: source)
      notebook = create(:notebook, hub: hub)
      notebook.topic_items.create!(topic: climate)

      expect(Document.tagged_with([climate.id])).not_to include(document)
      expect(Notebook.tagged_with([climate.id])).to include(notebook)
    end

    it "returns nothing when given no topics" do
      create(:document, source: source).topic_items.create!(topic: climate)

      expect(Document.tagged_with([])).to be_empty
    end
  end

  describe ".untagged" do
    it "returns the items that have no topics, whatever their type" do
      hub = create(:hub)
      source = create(:source, hub: hub)
      tagged = create(:document, source: source)
      tagged.topic_items.create!(topic: hub.topics.create!(name: "Climate"))
      untagged = create(:document, source: source)

      expect(Document.untagged).to contain_exactly(untagged)
    end
  end

  describe "#sorted_topic_items" do
    it "returns the item's topic memberships sorted by topic name" do
      hub = create(:hub)
      document = create(:document, source: create(:source, hub: hub))
      elections = document.topic_items.create!(topic: hub.topics.create!(name: "Elections"))
      climate = document.topic_items.create!(topic: hub.topics.create!(name: "Climate"))

      expect(document.sorted_topic_items).to eq([climate, elections])
    end

    it "returns an empty collection when the item has no topics" do
      expect(create(:notebook).sorted_topic_items).to eq([])
    end
  end

  describe "#destroy" do
    it "deletes the records of the topics removed from the item, whatever its type" do
      hub = create(:hub)
      items = [create(:document, source: create(:source, hub: hub)), create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| create(:deleted_topic_item, topic: create(:topic, hub: hub), item: item) }

      items.each do |item|
        expect { item.destroy }.to change(DeletedTopicItem, :count).by(-1), "expected #{item.class} to delete its records"
      end
    end

    it "does not delete the records of another type of item with the same id" do
      hub = create(:hub)
      document = create(:document, source: create(:source, hub: hub))
      notebook = create(:notebook, hub: hub, id: document.id)
      create(:deleted_topic_item, topic: create(:topic, hub: hub), item: document)

      notebook.destroy

      expect(document.deleted_topic_items.count).to eq(1)
    end
  end

  describe "#assign_topic_names" do
    let(:hub) { create(:hub) }
    let(:document) { create(:document, source: create(:source, hub: hub)) }

    it "assigns all names for a normal payload" do
      document.assign_topic_names(["Elections", "Climate", "Health"])

      expect(document.topics.pluck(:name)).to contain_exactly("Elections", "Climate", "Health")
    end

    it "uses the topic the hub already has of that name, whatever the case" do
      climate = hub.topics.create!(name: "Climate")

      expect {
        document.assign_topic_names(["climate", "CLIMATE"])
      }.not_to change { Topic.count }

      expect(document.topics).to eq([climate])
    end

    it "replaces the previously generated topics" do
      document.assign_topic_names(["Elections"])

      document.assign_topic_names(["Climate"])

      expect(document.topics.pluck(:name)).to eq(["Climate"])
    end

    it "keeps the topics a user added to an item, whatever its type" do
      housing = hub.topics.create!(name: "Housing")
      items = [document, create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| item.topic_items.create!(topic: housing, added_by: create(:user)) }

      items.each { |item| item.assign_topic_names(["Climate"]) }

      items.each do |item|
        expect(item.topics.pluck(:name)).to contain_exactly("Housing", "Climate"), "expected #{item.class} to keep the topic"
      end
    end

    it "does not replace a user-added topic when it is also generated" do
      user = create(:user)
      document.topic_items.create!(topic: hub.topics.create!(name: "Climate"), added_by: user)

      document.assign_topic_names(["Climate"])

      expect(document.topic_items.sole.added_by).to eq(user)
    end

    it "does not assign a topic a user removed from an item, whatever its type" do
      climate = hub.topics.create!(name: "Climate")
      items = [document, create(:contribution, hub: hub), create(:notebook, hub: hub)]
      items.each { |item| create(:deleted_topic_item, topic: climate, item: item) }

      items.each { |item| item.assign_topic_names(["Climate", "Elections"]) }

      items.each do |item|
        expect(item.topics.pluck(:name)).to eq(["Elections"]), "expected #{item.class} not to get the removed topic back"
      end
    end

    it "assigns a topic a user removed from another item" do
      climate = hub.topics.create!(name: "Climate")
      create(:deleted_topic_item, topic: climate, item: create(:notebook, hub: hub))

      document.assign_topic_names(["Climate"])

      expect(document.topics).to eq([climate])
    end

    it "ignores letter case when matching removed topics" do
      create(:deleted_topic_item, topic: hub.topics.create!(name: "Climate"), item: document)

      document.assign_topic_names(["climate"])

      expect(document.topics).to be_empty
    end

    it "drops the previously generated topics when all the names given were removed by a user" do
      document.topic_items.create!(topic: hub.topics.create!(name: "Housing"), added_by: create(:user))
      document.topic_items.create!(topic: hub.topics.create!(name: "Elections"))
      create(:deleted_topic_item, topic: hub.topics.create!(name: "Climate"), item: document)

      document.assign_topic_names(["Climate"])

      expect(document.topics.pluck(:name)).to eq(["Housing"])
    end

    it "caps the number of topics at MAX_TOPICS" do
      names = (1..60).map { |i| "Topic #{i}" }

      document.assign_topic_names(names)

      expect(document.topics.count).to eq(Topicable::MAX_TOPICS)
    end

    it "truncates an over-long topic name instead of raising" do
      long_name = "a" * (Topicable::MAX_TOPIC_NAME_LENGTH + 100)

      document.assign_topic_names([long_name])

      expect(document.topics.first.name.length).to eq(Topicable::MAX_TOPIC_NAME_LENGTH)
    end
  end
end
