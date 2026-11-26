require "rails_helper"

RSpec.describe WebhookServices::TelegramService, type: :service do
  let!(:telegram_service_double) { instance_double(TelegramService) }

  before do
    allow(TelegramService).to receive(:new).with("token").and_return(telegram_service_double)
    allow(telegram_service_double).to receive(:set_webhook).and_return(double("response", success?: true))
    allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))
  end

  it "parses payload and creates data" do
    integration = create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true)

    payload = JSON.parse({
      messaging_integration_id: integration.id,
      update_id: 10000,
      message: {
        date: 1441645532,
        chat: {
          last_name: "Bar",
          id: 1111111,
          first_name: "Foo",
          username: "foobar"
        },
        message_id: 1365,
        from: {
          last_name: "Bar",
          id: 1111111,
          first_name: "Foo",
          username: "foobar"
        },
        text: "Hello, this is a test message!"
      }
    }.to_json)

    service = described_class.new(payload)
    expect(service.valid?).to be(true)
    expect {
      service.process(integration.get_credential("webhook_secret"))
    }.to change(ExternalUser, :count).by(1)
      .and change(Conversation, :count).by(1)
      .and change(Message, :count).by(1)
  end

  context "when message is a reply to another message" do
    let!(:integration) { create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true) }
    let!(:external_user) { create(:external_user, hub: integration.hub, platform: "telegram", external_id: "1111111") }
    let!(:conversation) { create(:conversation, hub: integration.hub, platform: "telegram", participant: external_user) }
    let!(:original_message) { create(:message, :outgoing, conversation: conversation, external_id: integration.message_external_id(100)) }

    it "stores replied_to_message_id in metadata" do
      payload = {
        messaging_integration_id: integration.id,
        update_id: 10000,
        message: {
          date: 1441645532,
          chat: {id: 1111111},
          message_id: 1365,
          from: {id: 1111111, first_name: "Foo", last_name: "Bar"},
          text: "Replying to your message",
          reply_to_message: {message_id: 100}
        }
      }.deep_stringify_keys

      service = described_class.new(payload)
      service.process(integration.get_credential("webhook_secret"))

      reply = Message.incoming.last
      expect(reply.metadata["replied_to_message_id"]).to eq(original_message.id)
    end

    it "does not store replied_to_message_id when replied-to message is not found" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10000,
        message: {
          date: 1441645532,
          chat: {id: 1111111},
          message_id: 1366,
          from: {id: 1111111, first_name: "Foo", last_name: "Bar"},
          text: "Replying to unknown message",
          reply_to_message: {message_id: 99999}
        }
      }.to_json)

      service = described_class.new(payload)
      service.process(integration.get_credential("webhook_secret"))

      reply = Message.incoming.last
      expect(reply.metadata["replied_to_message_id"]).to be_nil
    end
  end

  it "accepts restarted message ids after the bot is replaced in the same hub" do
    old_integration = create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true)
    external_user = create(:external_user, hub: old_integration.hub, platform: "telegram", external_id: "1111111")
    conversation = create(:conversation, hub: old_integration.hub, platform: "telegram", participant: external_user)
    create(:message, :incoming, conversation: conversation, external_id: old_integration.message_external_id(1))
    old_integration.destroy!
    new_integration = create(:telegram_messaging_integration, hub: old_integration.hub, credentials: {bot_token: "token"}, active: true)

    payload = JSON.parse({
      messaging_integration_id: new_integration.id,
      message: {message_id: 1, from: {id: 1111111, first_name: "Foo"}, text: "Hello again"}
    }.to_json)

    expect {
      described_class.new(payload).process(new_integration.get_credential("webhook_secret"))
    }.to change(conversation.messages, :count).by(1)
  end

  context "when receiving unsupported message types" do
    let!(:integration) { create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true) }

    before do
      allow(TelegramService).to receive(:new).with("token").and_return(telegram_service_double)
      allow(telegram_service_double).to receive(:set_webhook).and_return(double("response", success?: true))
      allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))
    end

    it "creates an unsupported_message when text field is missing" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10004,
        message: {
          date: 1441645532,
          chat: {
            last_name: "Test",
            id: 4444444,
            first_name: "Alice",
            username: "alicetest"
          },
          message_id: 1369,
          from: {
            last_name: "Test",
            id: 4444444,
            first_name: "Alice",
            username: "alicetest"
          },
          photo: [
            {
              file_id: "photo_file_id_123",
              file_size: 12345
            }
          ]
        }
      }.to_json)

      service = described_class.new(payload)
      expect(service.valid?).to be(true)
      expect {
        service.process(integration.get_credential("webhook_secret"))
      }.to change(ExternalUser, :count).by(1)
        .and change(Conversation, :count).by(1)
        .and change(Message, :count).by(1)

      message = Message.last
      expect(message.state).to eq("unsupported_message")
      expect(message.direction).to eq("outgoing")
      expect(message.status).to eq("sent")
      expect(message.body).to eq(I18n.t(:error_message_type_unsupported))
    end
  end

  context "when receiving a reaction" do
    let!(:integration) { create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true) }

    it "logs the reaction and does not create any records" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10005,
        message_reaction: {
          chat: {id: 1111111, type: "private"},
          message_id: 42,
          user: {id: 1111111, first_name: "Foo", last_name: "Bar"},
          date: 1441645532,
          new_reaction: [{type: "emoji", emoji: "\u{1F44D}"}]
        }
      }.to_json)

      service = described_class.new(payload)
      expect(service.valid?).to be(true)

      expect(LogService).to receive(:log)

      expect {
        service.process(integration.get_credential("webhook_secret"))
      }.not_to change(Message, :count)
    end
  end

  context "when receiving callback queries" do
    let!(:integration) { create(:telegram_messaging_integration, credentials: {bot_token: "token"}, active: true) }
    let!(:external_user) { create(:external_user, hub: integration.hub, platform: "telegram", external_id: "1111111") }
    let!(:conversation) { create(:conversation, hub: integration.hub, platform: "telegram", participant: external_user) }
    let!(:document) { create(:document, source: create(:source, hub: integration.hub, source_type: :rss_feed)) }
    let!(:source_message) { create(:message, :outgoing, conversation: conversation, metadata: {answerable: true, document_ids_cited: [Base64.encode64("Document/#{document.id}")]}) }

    before do
      allow(telegram_service_double).to receive(:answer_callback_query).and_return(double("response", success?: true))
    end

    it "validates callback query payload" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10001,
        callback_query: {
          id: "callback_123",
          from: {
            id: 1111111,
            first_name: "Foo",
            last_name: "Bar"
          },
          data: "see_sources_#{source_message.id}"
        }
      }.to_json)

      service = described_class.new(payload)
      expect(service.valid?).to be(true)
    end

    it "is not valid when the callback query carries no data" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10001,
        callback_query: {
          id: "callback_123",
          from: {
            id: conversation.participant.external_id,
            first_name: "Foo",
            last_name: "Bar"
          }
        }
      }.to_json)

      service = described_class.new(payload)
      expect(service.valid?).to be(false)
    end

    it "creates sources message when callback query is received" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10001,
        callback_query: {
          id: "callback_123",
          from: {
            id: conversation.participant.external_id,
            first_name: "Foo",
            last_name: "Bar"
          },
          data: "see_sources_#{source_message.id}"
        }
      }.to_json)

      service = described_class.new(payload)
      expect {
        service.process(integration.get_credential("webhook_secret"))
      }.to change(Message, :count).by(1)

      sources_message = Message.last
      expect(sources_message.direction).to eq("outgoing")
      expect(sources_message.external_id).to start_with("sources_for_#{source_message.id}")
      expect(telegram_service_double).to have_received(:answer_callback_query).with("callback_123")
    end

    it "creates error message when source message is not found" do
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10002,
        callback_query: {
          id: "callback_456",
          from: {
            id: conversation.participant.external_id,
            first_name: "Foo",
            last_name: "Bar"
          },
          data: "see_sources_99999"
        }
      }.to_json)

      service = described_class.new(payload)
      expect {
        service.process(integration.get_credential("webhook_secret"))
      }.to change(Message, :count).by(1)

      error_message = Message.last
      expect(error_message.body).to eq(I18n.t(:message_sources_not_available))
    end

    it "creates error message when source message has no public source documents" do
      source_message.update!(metadata: {answerable: true})
      source_message.message_data_source_items.destroy_all
      payload = JSON.parse({
        messaging_integration_id: integration.id,
        update_id: 10003,
        callback_query: {
          id: "callback_789",
          from: {
            id: conversation.participant.external_id,
            first_name: "Foo",
            last_name: "Bar"
          },
          data: "see_sources_#{source_message.id}"
        }
      }.to_json)

      service = described_class.new(payload)
      expect {
        service.process(integration.get_credential("webhook_secret"))
      }.to change(Message, :count).by(1)

      error_message = Message.last
      expect(error_message.body).to eq(I18n.t(:message_sources_not_available))
    end
  end
end
