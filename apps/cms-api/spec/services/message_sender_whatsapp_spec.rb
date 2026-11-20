require "rails_helper"

RSpec.describe MessageSenderServices::WhatsappService, type: :service do
  let!(:whatsapp_service_double) { instance_double(WhatsappService) }
  let!(:hub) { create(:hub) }
  let!(:message) { create(:message, :outgoing, conversation: create(:conversation, hub: hub, platform: "whatsapp", participant: create(:external_user, platform: "whatsapp", external_id: "uid"))) }

  before do
    allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
    create(:whatsapp_messaging_integration, hub: hub, active: true, credentials: {phone_number_id: "phone_id", business_token: "token"})
  end

  let(:cooldown) { ExternalUserCooldown.new(message.conversation.participant) }

  after { cooldown.reset! }

  it "should update message status when message is sent successfully" do
    allow(whatsapp_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "message_id"))
    service = MessageSenderServices::WhatsappService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("sent")
    expect(message.reload.external_id).to eq("message_id")
  end

  it "should update message status when message is not sent" do
    allow(whatsapp_service_double).to receive(:send_message).and_return(double("response", success?: false, body: "Error"))
    allow(LogService).to receive(:log)
    service = MessageSenderServices::WhatsappService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("failed")
    expect(message.reload.external_id).to be_nil
    expect(LogService).to have_received(:log).with(:error, "MessageSenderServices::WhatsappService", "Failed to send message #{message.id} to WhatsApp: Error")
  end

  it "should update message status when sending message triggers an exception" do
    allow(whatsapp_service_double).to receive(:send_message).and_raise(StandardError.new("Test error"))
    allow(LogService).to receive(:log)
    service = MessageSenderServices::WhatsappService.new(message)
    expect(message.reload.external_id).to be_nil
    service.send_message
    expect(message.reload.status).to eq("failed")
    expect(message.reload.external_id).to be_nil
    expect(LogService).to have_received(:log).with(:error, "MessageSenderServices::WhatsappService", "Exception on sending message #{message.id} to WhatsApp: Test error")
    expect(message.metadata).not_to have_key("delivery_error")
  end

  it "stores Meta's error details rather than the log-safe exception message" do
    error = WhatsappService::Error.new("Send message failed: code=400", 100, nil, "Param text['body'] must be at most 4096 characters long.")
    allow(whatsapp_service_double).to receive(:send_message).and_raise(error)
    allow(LogService).to receive(:log)
    MessageSenderServices::WhatsappService.new(message).send_message
    expect(message.reload.metadata["delivery_error"]).to eq("code" => "100", "message" => "Param text['body'] must be at most 4096 characters long.")
  end

  it "should fail the message without sending while the recipient is in cooldown" do
    cooldown.start!
    expect(whatsapp_service_double).not_to receive(:send_message)

    MessageSenderServices::WhatsappService.new(message).send_message

    expect(message.reload.status).to eq("failed")
    expect(message.reload.external_id).to be_nil
  end

  it "should start a cooldown when WhatsApp reports the per-recipient rate limit" do
    error = WhatsappService::Error.new("Send message failed", WhatsappService::PAIR_RATE_LIMIT_ERROR_CODE)
    allow(whatsapp_service_double).to receive(:send_message).and_raise(error)
    allow(LogService).to receive(:log)

    expect {
      MessageSenderServices::WhatsappService.new(message).send_message
    }.to change { cooldown.active? }.from(false).to(true)
  end

  it "should not start a cooldown for an unrelated send failure" do
    allow(whatsapp_service_double).to receive(:send_message).and_raise(WhatsappService::Error.new("Send message failed", 131047))
    allow(LogService).to receive(:log)

    expect {
      MessageSenderServices::WhatsappService.new(message).send_message
    }.not_to change { cooldown.active? }
  end

  it "should return early when messaging integration is nil" do
    allow(WhatsappMessagingIntegration).to receive(:find_by).with(hub: hub, active: true).and_return(nil)
    service = MessageSenderServices::WhatsappService.new(message)
    expect(whatsapp_service_double).not_to receive(:send_message)
    service.send_message
    expect(message.reload.external_id).to be_nil
  end

  it "should not send through a deactivated integration" do
    WhatsappMessagingIntegration.find_by(hub: hub).update!(active: false)
    expect(whatsapp_service_double).not_to receive(:send_message)
    MessageSenderServices::WhatsappService.new(message).send_message
    expect(message.reload.external_id).to be_nil
  end

  describe "topic notification" do
    let(:document) { create(:document, source: create(:source, hub: hub)) }
    let(:topic) { hub.topics.create!(name: "Climate") }
    let(:notification) do
      message = create(:message, :outgoing, state: :topic_notification,
        conversation: create(:conversation, hub: hub, platform: "whatsapp", participant: create(:external_user, hub: hub, platform: "whatsapp", external_id: "wa_uid")),
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)
      message
    end

    it "sends the approved template instead of a regular message" do
      response = double("response", success?: true, dig: "tmpl_msg_id")
      expect(whatsapp_service_double).to receive(:send_template_message).with(
        "phone_id",
        "token",
        "wa_uid",
        WhatsappMessagingIntegration.topic_notification_template_name("journalist"),
        WhatsappMessagingIntegration.template_language_code(notification.conversation.language),
        ["Climate", "\"#{document.title}\"."],
        ["see_sources_#{notification.id}", "unsubscribe_#{topic.id}"]
      ).and_return(response)

      MessageSenderServices::WhatsappService.new(notification).send_message

      expect(notification.reload.status).to eq("sent")
    end
  end

  describe "intermediary messages" do
    let!(:intermediary_message) { create(:message, :outgoing, state: :bot_intermediary_message, body: "Checking sources...", conversation: create(:conversation, hub: hub, platform: "whatsapp", participant: create(:external_user, platform: "whatsapp", external_id: "uid"))) }

    it "sends intermediary message body wrapped in underscores for italic" do
      allow(whatsapp_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "message_id"))

      service = MessageSenderServices::WhatsappService.new(intermediary_message)
      service.send_message

      expect(whatsapp_service_double).to have_received(:send_message).with(
        "phone_id", "token", "uid", "_Checking sources..._"
      )
    end
  end

  describe "interactive messages" do
    before do
      allow(whatsapp_service_double).to receive(:send_interactive_message).and_return(double("response", success?: true, dig: "message_id"))
    end

    it "should send interactive message when message has buttons" do
      document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      message_with_buttons = create(:message, :outgoing, conversation: create(:conversation, hub: hub, platform: "whatsapp", participant: create(:external_user, platform: "whatsapp", external_id: "uid")), metadata: {answerable: true, document_ids_cited: [Base64.encode64("Document/#{document.id}")]})

      service = MessageSenderServices::WhatsappService.new(message_with_buttons)
      service.send_message

      expect(whatsapp_service_double).to have_received(:send_interactive_message).with(
        "phone_id",
        "token",
        "uid",
        message_with_buttons.body,
        hash_including(id: "see_sources_#{message_with_buttons.id}", title: I18n.t(:label_see_sources))
      )
      expect(message_with_buttons.reload.status).to eq("sent")
    end

    it "should send regular message when message has no buttons" do
      allow(whatsapp_service_double).to receive(:send_message).and_return(double("response", success?: true, dig: "message_id"))

      service = MessageSenderServices::WhatsappService.new(message)
      service.send_message

      expect(whatsapp_service_double).to have_received(:send_message)
      expect(whatsapp_service_double).not_to have_received(:send_interactive_message)
    end
  end
end
