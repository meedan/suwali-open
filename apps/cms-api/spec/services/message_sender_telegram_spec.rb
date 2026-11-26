require "rails_helper"

RSpec.describe MessageSenderServices::TelegramService, type: :service do
  let!(:telegram_service_double) { instance_double(TelegramService) }
  let!(:hub) { create(:hub) }
  let!(:message) { create(:message, :outgoing, conversation: create(:conversation, hub: hub, platform: "telegram", participant: create(:external_user, platform: "telegram", external_id: "uid"))) }

  before do
    allow(TelegramService).to receive(:new).with("token").and_return(telegram_service_double)
    allow(telegram_service_double).to receive(:set_webhook).and_return(double("response", success?: true))
    allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))
    create(:telegram_messaging_integration, hub: hub, active: true, credentials: {bot_token: "token"})
  end

  it "should update message status when message is sent successfully" do
    allow(telegram_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "mid"))
    service = MessageSenderServices::TelegramService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("sent")
    expect(message.reload.external_id).to eq(TelegramMessagingIntegration.find_by(hub: hub).message_external_id("mid"))
  end

  it "should update message status when message is not sent" do
    error_body = {"ok" => false, "error_code" => 403, "description" => "Forbidden: bot was blocked by the user"}
    allow(telegram_service_double).to receive(:send_message).and_return(double("response", success?: false, body: "Error", code: 403, parsed_response: error_body))
    service = MessageSenderServices::TelegramService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("failed")
    expect(message.metadata["delivery_error"]).to eq("code" => "403", "message" => "Forbidden: bot was blocked by the user")
    expect(message.reload.external_id).to be_nil
  end

  it "should update message status when sending message triggers an exception" do
    allow(telegram_service_double).to receive(:send_message).and_raise(StandardError)
    service = MessageSenderServices::TelegramService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("failed")
    expect(message.reload.external_id).to be_nil
  end

  it "should fail the message instead of sending through a deactivated integration" do
    TelegramMessagingIntegration.find_by(hub: hub).update!(active: false)
    # With no active integration there is no bot token: the client is built with nil and the send fails.
    dead_client = instance_double(TelegramService)
    allow(TelegramService).to receive(:new).with(nil).and_return(dead_client)
    allow(dead_client).to receive(:send_message).and_return(double("response", success?: false, body: "Not Found", code: 404, parsed_response: "Not Found"))
    allow(LogService).to receive(:log)

    MessageSenderServices::TelegramService.new(message).send_message

    expect(message.reload.status).to eq("failed")
    expect(message.reload.external_id).to be_nil
  end

  describe "topic notification" do
    let(:document) { create(:document, source: create(:source, hub: hub)) }
    let(:topic) { hub.topics.create!(name: "Climate") }
    let(:notification) do
      message = create(:message, :outgoing, state: :topic_notification,
        conversation: create(:conversation, hub: hub, platform: "telegram", participant: create(:external_user, hub: hub, platform: "telegram", external_id: "tg_uid")),
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)
      message
    end

    it "sends a regular message with See More and Unsubscribe inline buttons" do
      captured = nil
      allow(telegram_service_double).to receive(:send_message) do |**kwargs|
        captured = kwargs
        double("response", success?: true, dig: "mid")
      end

      MessageSenderServices::TelegramService.new(notification).send_message

      keyboard = captured[:reply_markup][:inline_keyboard].first
      expect(keyboard.map { |button| button[:callback_data] }).to eq(["see_sources_#{notification.id}", "unsubscribe_#{topic.id}"])
    end
  end

  describe "intermediary messages" do
    let!(:intermediary_message) { create(:message, :outgoing, state: :bot_intermediary_message, body: "Checking sources...", conversation: create(:conversation, hub: hub, platform: "telegram", participant: create(:external_user, platform: "telegram", external_id: "uid"))) }

    it "sends intermediary message in italic with HTML parse mode" do
      allow(telegram_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "mid"))

      service = MessageSenderServices::TelegramService.new(intermediary_message)
      service.send_message

      expect(telegram_service_double).to have_received(:send_message).with(hash_including(
        text: "<i>Checking sources...</i>",
        parse_mode: "HTML"
      ))
    end
  end

  describe "inline keyboards" do
    it "should send message with inline keyboard when message has buttons" do
      document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      message_with_buttons = create(:message, :outgoing, conversation: create(:conversation, hub: hub, platform: "telegram", participant: create(:external_user, platform: "telegram", external_id: "uid")), metadata: {answerable: true, document_ids_cited: [Base64.encode64("Document/#{document.id}")]})
      allow(telegram_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "mid"))

      service = MessageSenderServices::TelegramService.new(message_with_buttons)
      service.send_message

      expect(telegram_service_double).to have_received(:send_message).with(hash_including(
        chat_id: "uid",
        text: message_with_buttons.body,
        reply_markup: {
          inline_keyboard: [[{text: I18n.t(:label_see_sources), callback_data: "see_sources_#{message_with_buttons.id}"}]]
        }
      ))
      expect(message_with_buttons.reload.status).to eq("sent")
    end

    it "should send regular message when message has no buttons" do
      allow(telegram_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "mid"))

      service = MessageSenderServices::TelegramService.new(message)
      service.send_message

      expect(telegram_service_double).to have_received(:send_message).with(hash_including(
        chat_id: "uid",
        text: message.body
      ))
      expect(telegram_service_double).to have_received(:send_message).with(hash_not_including(:reply_markup))
    end
  end
end
