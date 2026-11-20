require "rails_helper"

RSpec.describe WebhookServices::BaseService, type: :service do
  # Minimal concrete subclass to exercise the shared button-callback logic
  let(:service_class) do
    Class.new(described_class) do
      def initialize(hub)
        @hub = hub
      end

      def platform_name
        "whatsapp"
      end
    end
  end
  let(:hub) { create(:hub) }
  let(:external_user) { create(:external_user, hub: hub, platform: "whatsapp") }
  let(:conversation) { create(:conversation, hub: hub, participant: external_user, platform: "whatsapp") }
  let(:service) { service_class.new(hub) }

  def closed_window_with_topics(topic_names)
    topics = topic_names.map { |name| hub.topics.create!(name: name) }
    # The conversation is about these topics (message topics) and each is backed by a document.
    create(:message, :incoming, conversation: conversation).topics = topics
    topics.each { |topic| create(:document, source: create(:source, hub: hub)).topics << topic }
    create(:message, :outgoing, conversation: conversation, state: :closed_window)
  end

  describe "#create_sources_message" do
    it "marks a sources reply to a topic notification as out-of-band, so it does not start the inactivity timer" do
      notification = create(:message, :outgoing, conversation: conversation, state: :topic_notification)

      sources = service.send(:create_sources_message, conversation, notification, {"id" => "cb1"})

      expect(sources.topic_notification_sources?).to be(true)
    end

    it "leaves a sources reply to a normal answer without a special state" do
      answer = create(:message, :outgoing, conversation: conversation)

      sources = service.send(:create_sources_message, conversation, answer, {"id" => "cb1"})

      expect(sources.topic_notification_sources?).to be(false)
    end
  end

  describe "#handle_button_callback with no callback data" do
    it "ignores a nil callback_data instead of raising, and logs a warning" do
      expect(LogService).to receive(:log).with(:warn, "WebhookServices::BaseService", /no data for conversation #{conversation.id}/)

      expect {
        service.send(:handle_button_callback, nil, conversation, {"id" => "cb1"})
      }.not_to raise_error
    end
  end

  describe "#handle_button_callback with a subscribe payload" do
    it "subscribes the external user to the window's topics" do
      closing = closed_window_with_topics(["Climate", "Health"])

      expect {
        service.send(:handle_button_callback, "subscribe_#{closing.id}", conversation, {"id" => "cb1"})
      }.to change(TopicSubscription, :count).by(2)

      expect(external_user.subscribed_topics.map(&:name)).to match_array(["Climate", "Health"])
    end

    it "creates a confirmation message listing the topics" do
      closing = closed_window_with_topics(["Climate"])

      service.send(:handle_button_callback, "subscribe_#{closing.id}", conversation, {"id" => "cb1"})

      confirmation = Message.where(state: :subscription_confirmed).last
      expect(confirmation.direction).to eq("outgoing")
      expect(confirmation.body).to eq(I18n.t(:message_subscription_confirmed_journalist, topics: "Climate"))
    end

    it "uses the hub's tone variant in the confirmation" do
      hub.update!(bot_attributes: {"tone" => "executive"})
      closing = closed_window_with_topics(["Climate"])

      service.send(:handle_button_callback, "subscribe_#{closing.id}", conversation, {"id" => "cb1"})

      confirmation = Message.where(state: :subscription_confirmed).last
      expect(confirmation.body).to eq(I18n.t(:message_subscription_confirmed_executive, topics: "Climate"))
    end

    it "is idempotent when the user clicks Subscribe again" do
      closing = closed_window_with_topics(["Climate"])
      service.send(:handle_button_callback, "subscribe_#{closing.id}", conversation, {"id" => "cb1"})

      expect {
        service.send(:handle_button_callback, "subscribe_#{closing.id}", conversation, {"id" => "cb2"})
      }.not_to change(TopicSubscription, :count)
    end

    it "sends an error message when the referenced message no longer exists" do
      expect {
        service.send(:handle_button_callback, "subscribe_999999", conversation, {"id" => "cb1"})
      }.not_to change(TopicSubscription, :count)

      expect(Message.last.body).to eq(I18n.t(:message_subscription_failed))
    end
  end

  describe "#handle_button_callback with an unsubscribe payload" do
    let(:topic) { hub.topics.create!(name: "Climate") }

    before { TopicSubscription.create!(external_user: external_user, topic: topic) }

    it "removes the user's subscription to the topic" do
      expect {
        service.send(:handle_button_callback, "unsubscribe_#{topic.id}", conversation, {"id" => "cb1"})
      }.to change(TopicSubscription, :count).by(-1)

      expect(external_user.reload.subscribed_topics).to be_empty
    end

    it "creates a confirmation message naming the topic" do
      service.send(:handle_button_callback, "unsubscribe_#{topic.id}", conversation, {"id" => "cb1"})

      confirmation = Message.where(state: :unsubscription_confirmed).last
      expect(confirmation.direction).to eq("outgoing")
      expect(confirmation.body).to eq(I18n.t(:message_unsubscription_confirmed_journalist, topic: "Climate"))
    end

    it "uses the hub's tone variant in the confirmation" do
      hub.update!(bot_attributes: {"tone" => "advocate"})

      service.send(:handle_button_callback, "unsubscribe_#{topic.id}", conversation, {"id" => "cb1"})

      confirmation = Message.where(state: :unsubscription_confirmed).last
      expect(confirmation.body).to eq(I18n.t(:message_unsubscription_confirmed_advocate, topic: "Climate"))
    end

    it "is idempotent when the user is no longer subscribed" do
      service.send(:handle_button_callback, "unsubscribe_#{topic.id}", conversation, {"id" => "cb1"})

      expect {
        service.send(:handle_button_callback, "unsubscribe_#{topic.id}", conversation, {"id" => "cb2"})
      }.not_to change(TopicSubscription, :count)

      expect(Message.where(state: :unsubscription_confirmed).count).to eq(2)
    end

    it "sends an error message when the topic does not exist" do
      expect {
        service.send(:handle_button_callback, "unsubscribe_999999", conversation, {"id" => "cb1"})
      }.not_to change(TopicSubscription, :count)

      expect(Message.last.body).to eq(I18n.t(:message_subscription_failed))
    end

    it "removes every subscription covered by a merged notification's button" do
      health = hub.topics.create!(name: "Health")
      TopicSubscription.create!(external_user: external_user, topic: health)

      expect {
        service.send(:handle_button_callback, "unsubscribe_#{topic.id}_#{health.id}", conversation, {"id" => "cb1"})
      }.to change(TopicSubscription, :count).by(-2)

      confirmation = Message.where(state: :unsubscription_confirmed).last
      expect(confirmation.body).to eq(I18n.t(:message_unsubscription_confirmed_journalist, topic: "Climate and Health"))
    end
  end

  describe "#handle_button_callback with a cancel_contribution payload" do
    let(:prompt) { create(:message, conversation: conversation, direction: :outgoing, state: :bot_contribution_started) }

    context "when the conversation is awaiting a contribution" do
      before { conversation.update!(state: :awaiting_contribution) }

      it "resets the conversation to normal and confirms the cancellation" do
        expect {
          service.send(:handle_button_callback, "cancel_contribution_#{prompt.id}", conversation, {"id" => "cb1"})
        }.to change { conversation.reload.state }.from("awaiting_contribution").to("normal")

        confirmation = Message.where(state: :bot_contribution_cancelled).last
        expect(confirmation.direction).to eq("outgoing")
        expect(confirmation.body).to eq(I18n.t(:contribution_cancel))
      end
    end

    it "does nothing when the conversation is not awaiting a contribution" do
      expect {
        service.send(:handle_button_callback, "cancel_contribution_#{prompt.id}", conversation, {"id" => "cb1"})
      }.not_to change { Message.where(state: :bot_contribution_cancelled).count }
    end
  end

  describe "#process_delivery_status_change" do
    it "hands off to DeliveryStatusChangeWorker" do
      expect(DeliveryStatusChangeWorker).to receive(:perform_async).with("uid", "delivered", {"foo" => "bar"})
      service.send(:process_delivery_status_change, "uid", "delivered", {"foo" => "bar"})
    end

    it "makes sure we are sending a value that sidekiq can parse" do
      indifferent_details = ActiveSupport::HashWithIndifferentAccess.new("foo" => "bar")
      expect {
        service.send(:process_delivery_status_change, "uid", "delivered", indifferent_details)
      }.not_to raise_error
      DeliveryStatusChangeWorker.clear
    end
  end

  describe "#find_or_create_external_user" do
    let(:user_data) { {id: "551191234567", name: "Ana", raw: {"wa_id" => "551191234567"}} }

    it "adopts the id WhatsApp sent when the end-user was added under the other Brazilian form" do
      trusted = create(:external_user, hub: hub, platform: "whatsapp", external_id: "5511991234567", trusted_user: true)

      found = service.send(:find_or_create_external_user, user_data)

      expect(found.id).to eq(trusted.id)
      expect(found.reload.external_id).to eq("551191234567")
      expect(hub.external_users.where(platform: "whatsapp").count).to eq(1)
    end

    it "creates a new end-user when no stored number matches" do
      create(:external_user, hub: hub, platform: "whatsapp", external_id: "5511932654321")

      expect { service.send(:find_or_create_external_user, user_data) }
        .to change { hub.external_users.count }.by(1)
    end

    it "leaves both records alone when each spelling already exists" do
      exact = create(:external_user, hub: hub, platform: "whatsapp", external_id: "551191234567")
      other = create(:external_user, hub: hub, platform: "whatsapp", external_id: "5511991234567", trusted_user: true)

      found = service.send(:find_or_create_external_user, user_data)

      expect(found.id).to eq(exact.id)
      expect(other.reload.external_id).to eq("5511991234567")
    end

    it "does not match an end-user belonging to another hub" do
      other_hub = create(:hub)
      create(:external_user, hub: other_hub, platform: "whatsapp", external_id: "5511991234567", trusted_user: true)

      found = service.send(:find_or_create_external_user, user_data)

      expect(found.hub_id).to eq(hub.id)
      expect(found.trusted_user).to be(false)
    end
  end

  describe "#trackable_delivery_status?" do
    it "is true for delivered and failed" do
      expect(service.send(:trackable_delivery_status?, "delivered")).to be(true)
      expect(service.send(:trackable_delivery_status?, "failed")).to be(true)
    end

    it "is false for statuses that only confirm sending, or that we don't track (e.g. WhatsApp's read)" do
      expect(service.send(:trackable_delivery_status?, "sent")).to be(false)
      expect(service.send(:trackable_delivery_status?, "read")).to be(false)
      expect(service.send(:trackable_delivery_status?, "queued")).to be(false)
    end
  end
end
