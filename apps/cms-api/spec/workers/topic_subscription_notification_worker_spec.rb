require "rails_helper"

RSpec.describe TopicSubscriptionNotificationWorker, type: :worker do
  let(:hub) { create(:hub, bot_attributes: {"tone" => "advocate"}) }
  let(:document) { create(:document, source: create(:source, hub: hub, source_type: :rss_feed)) }
  let(:topic) { hub.topics.create!(name: "Climate") }
  let(:topic_item) { create(:topic_item, topic: topic, item: document) }

  let!(:whatsapp_subscriber) { create(:external_user, hub: hub, platform: "whatsapp", external_id: "wa_1") }
  let!(:telegram_subscriber) { create(:external_user, hub: hub, platform: "telegram", external_id: "tg_1") }
  let!(:whatsapp_conversation) { create(:conversation, hub: hub, participant: whatsapp_subscriber, platform: "whatsapp") }
  let!(:telegram_conversation) { create(:conversation, hub: hub, participant: telegram_subscriber, platform: "telegram") }

  before do
    TopicSubscription.create!(topic: topic, external_user: whatsapp_subscriber)
    TopicSubscription.create!(topic: topic, external_user: telegram_subscriber)
  end

  it "creates a notification message for each subscriber regardless of platform" do
    expect { described_class.new.perform(topic_item.id) }
      .to change { Message.where(state: :topic_notification).count }.by(2)
  end

  it "attaches the data source item to the notification message" do
    described_class.new.perform(topic_item.id)

    message = Message.where(state: :topic_notification).first
    expect(message.message_data_source_items.map(&:item)).to eq([document])
    expect(message.metadata["notification_topic_ids"]).to eq([topic.id])
  end

  it "renders the body with the hub tone, topic name and item title" do
    described_class.new.perform(topic_item.id)

    message = Message.where(state: :topic_notification).first
    expected = I18n.with_locale(message.conversation.language) do
      I18n.t(:topic_notification_body_advocate, topic: "Climate", content: "\"#{document.title}\".")
    end
    expect(message.body).to eq(expected)
  end

  it "includes the newest document's URL in the notification body" do
    document.update!(metadata: {"url" => "https://example.com/article"})

    described_class.new.perform(topic_item.id)

    message = Message.where(state: :topic_notification).first
    expect(message.body).to include("\"#{document.title}\" (https://example.com/article).")
  end

  it "delivers the notification into the subscriber's existing conversation" do
    expect { described_class.new.perform(topic_item.id) }
      .to change { whatsapp_conversation.messages.where(state: :topic_notification).count }.by(1)
  end

  it "skips subscribers that have no conversation" do
    no_conversation_subscriber = create(:external_user, hub: hub, platform: "whatsapp", external_id: "wa_2")
    TopicSubscription.create!(topic: topic, external_user: no_conversation_subscriber)

    expect { described_class.new.perform(topic_item.id) }
      .to change { Message.where(state: :topic_notification).count }.by(2)
  end

  it "skips subscribers whose conversation is soft-deleted" do
    whatsapp_conversation.update!(deleted_at: Time.current)

    expect { described_class.new.perform(topic_item.id) }
      .to change { Message.where(state: :topic_notification).count }.by(1)
    expect(whatsapp_conversation.messages.where(state: :topic_notification)).to be_empty
  end

  it "does nothing when the topic item does not exist" do
    expect { described_class.new.perform(0) }.not_to change(Message, :count)
  end

  it "skips subscribers who are mid-conversation" do
    create(:message, :incoming, conversation: whatsapp_conversation) # user just messaged

    expect { described_class.new.perform(topic_item.id) }
      .to change { Message.where(state: :topic_notification).count }.by(1)

    expect(whatsapp_conversation.messages.where(state: :topic_notification)).to be_empty
  end

  it "does nothing when the triggering item is not a data source item" do
    message = create(:message, :outgoing, conversation: whatsapp_conversation)
    message_topic_item = create(:topic_item, topic: topic, item: message)

    expect { described_class.new.perform(message_topic_item.id) }
      .not_to change { Message.where(state: :topic_notification).count }
  end

  describe "digesting" do
    it "batches all new items for a topic into a single message per subscriber" do
      topic_item # ensure the first item has a topic item
      second_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      second_item = create(:topic_item, topic: topic, item: second_document)

      expect { described_class.new.perform(second_item.id) }
        .to change { Message.where(state: :topic_notification).count }.by(2)

      message = whatsapp_conversation.messages.where(state: :topic_notification).first
      expect(message.message_data_source_items.map(&:item)).to match_array([document, second_document])
    end

    it "summarizes the content as the newest title plus a count of the rest" do
      topic_item
      second_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      second_item = create(:topic_item, topic: topic, item: second_document)

      described_class.new.perform(second_item.id)

      message = whatsapp_conversation.messages.where(state: :topic_notification).first
      expect(message.body).to include(I18n.t(:topic_notification_content_summary, title: "\"#{second_document.title}\"", count: 1))
    end

    it "includes only documents created since the subscription in the first digest" do
      old_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      old_document.update_column(:created_at, 2.days.ago)
      create(:topic_item, topic: topic, item: old_document)

      described_class.new.perform(topic_item.id)

      message = whatsapp_conversation.messages.where(state: :topic_notification).first
      expect(message.message_data_source_items.map(&:item)).to eq([document])
    end

    it "does not notify when topics are backfilled onto old documents (e.g. by a rake task)" do
      backfilled_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      backfilled_document.update_column(:created_at, 2.days.ago)
      backfilled_item = create(:topic_item, topic: topic, item: backfilled_document)

      expect { described_class.new.perform(backfilled_item.id) }
        .not_to change { Message.where(state: :topic_notification).count }
    end

    it "excludes documents from non-public sources from the digest" do
      topic_item # public document
      private_document = create(:document, source: create(:source, hub: hub, source_type: :uploaded_files))
      create(:topic_item, topic: topic, item: private_document)

      described_class.new.perform(topic_item.id)

      message = whatsapp_conversation.messages.where(state: :topic_notification).first
      expect(message.message_data_source_items.map(&:item)).to eq([document])
    end

    it "does nothing when the triggering item is from a non-public source" do
      private_document = create(:document, source: create(:source, hub: hub, source_type: :uploaded_files))
      private_item = create(:topic_item, topic: topic, item: private_document)

      expect { described_class.new.perform(private_item.id) }
        .not_to change { Message.where(state: :topic_notification).count }
    end
  end

  describe "grouping topics by document set" do
    let(:health_topic) { hub.topics.create!(name: "Health") }

    before { TopicSubscription.create!(topic: health_topic, external_user: whatsapp_subscriber) }

    it "merges topics covering the same set of documents into a single notification" do
      create(:topic_item, topic: health_topic, item: document)

      expect { described_class.new.perform(topic_item.id) }
        .to change { whatsapp_conversation.messages.where(state: :topic_notification).count }.by(1)

      message = whatsapp_conversation.messages.where(state: :topic_notification).first
      expect(message.metadata["notification_topic_ids"]).to eq([topic.id, health_topic.id].sort)
      expect(message.body).to include("Climate and Health")
      expect(message.message_data_source_items.map(&:item)).to eq([document])
    end

    it "does not send a second notification when the merged topic's own worker runs" do
      health_item = create(:topic_item, topic: health_topic, item: document)
      described_class.new.perform(topic_item.id)

      expect { described_class.new.perform(health_item.id) }
        .not_to change { Message.where(state: :topic_notification).count }
    end

    it "keeps topics with different document sets in separate notifications" do
      topic_item # Climate: document
      second_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      climate_item = create(:topic_item, topic: topic, item: second_document) # Climate: document + second_document
      health_item = create(:topic_item, topic: health_topic, item: second_document) # Health: second_document

      described_class.new.perform(health_item.id)
      described_class.new.perform(climate_item.id)

      messages = whatsapp_conversation.messages.where(state: :topic_notification).order(:id)
      expect(messages.map { |message| message.metadata["notification_topic_ids"] }).to eq([[health_topic.id], [topic.id]])
      expect(messages.first.message_data_source_items.map(&:item)).to eq([second_document])
      expect(messages.last.message_data_source_items.map(&:item)).to match_array([document, second_document])
    end

    it "only merges topics the subscriber follows" do
      create(:topic_item, topic: health_topic, item: document)

      described_class.new.perform(topic_item.id)

      message = telegram_conversation.messages.where(state: :topic_notification).first
      expect(message.metadata["notification_topic_ids"]).to eq([topic.id])
    end

    it "excludes topics inside their cooldown window from the merge" do
      earlier_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      earlier_item = create(:topic_item, topic: health_topic, item: earlier_document)
      described_class.new.perform(earlier_item.id) # Health notified, now in cooldown

      create(:topic_item, topic: health_topic, item: document)

      expect { described_class.new.perform(topic_item.id) }
        .to change { whatsapp_conversation.messages.where(state: :topic_notification).count }.by(1)

      message = whatsapp_conversation.messages.where(state: :topic_notification).order(:id).last
      expect(message.metadata["notification_topic_ids"]).to eq([topic.id])
    end
  end

  describe "throttling" do
    it "does not notify again within the cooldown window" do
      described_class.new.perform(topic_item.id)

      newer_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      newer_item = create(:topic_item, topic: topic, item: newer_document)

      expect { described_class.new.perform(newer_item.id) }
        .not_to change { Message.where(state: :topic_notification).count }
    end

    it "notifies again once the cooldown has passed" do
      TopicSubscription.update_all(created_at: 3.days.ago)
      described_class.new.perform(topic_item.id)
      Message.where(state: :topic_notification).update_all(created_at: (described_class::NOTIFICATION_COOLDOWN + 1.hour).ago)

      newer_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      newer_item = create(:topic_item, topic: topic, item: newer_document)

      expect { described_class.new.perform(newer_item.id) }
        .to change { Message.where(state: :topic_notification).count }.by(2)
    end

    it "respects the cooldown recorded by messages created before topics could merge" do
      create(:message, :outgoing, conversation: whatsapp_conversation, state: :topic_notification,
        metadata: {"notification_topic_id" => topic.id})

      expect { described_class.new.perform(topic_item.id) }
        .not_to change { whatsapp_conversation.messages.where(state: :topic_notification).count }
    end

    it "throttles per topic, so other topics still notify" do
      described_class.new.perform(topic_item.id)

      other_topic = hub.topics.create!(name: "Health")
      TopicSubscription.create!(topic: other_topic, external_user: whatsapp_subscriber)
      other_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      other_item = create(:topic_item, topic: other_topic, item: other_document)

      expect { described_class.new.perform(other_item.id) }
        .to change { whatsapp_conversation.messages.where(state: :topic_notification).count }.by(1)
    end
  end
end
