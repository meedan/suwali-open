require "rails_helper"

RSpec.describe TypingIndicatorWorker, type: :worker do
  let(:hub) { create(:hub) }

  describe "#perform" do
    context "for a WhatsApp conversation" do
      let(:whatsapp_service_double) { instance_double(WhatsappService) }
      let(:conversation) { create(:conversation, hub: hub, platform: "whatsapp", participant: create(:external_user, platform: "whatsapp", external_id: "uid")) }
      let(:incoming_message) { create(:message, :incoming, conversation: conversation, external_id: "wamid.ABC123") }

      before do
        allow(WhatsappService).to receive(:new).and_return(whatsapp_service_double)
        create(:whatsapp_messaging_integration, hub: hub, credentials: {phone_number_id: "phone_id", business_token: "token"})
      end

      it "sends the typing indicator for the incoming message" do
        expect(whatsapp_service_double).to receive(:send_typing_indicator).with("phone_id", "token", "wamid.ABC123")

        described_class.new.perform(incoming_message.id)
      end

      it "does nothing when a reply already exists" do
        create(:message, :outgoing, conversation: conversation, reply_to: incoming_message)

        expect(whatsapp_service_double).not_to receive(:send_typing_indicator)
        described_class.new.perform(incoming_message.id)
      end

      it "does nothing when the message has no external_id" do
        message = create(:message, :incoming, conversation: conversation)

        expect(whatsapp_service_double).not_to receive(:send_typing_indicator)
        described_class.new.perform(message.id)
      end

      it "does nothing for outgoing messages" do
        message = create(:message, :outgoing, conversation: conversation, external_id: "wamid.OUT")

        expect(whatsapp_service_double).not_to receive(:send_typing_indicator)
        described_class.new.perform(message.id)
      end

      it "does nothing when message does not exist" do
        expect(whatsapp_service_double).not_to receive(:send_typing_indicator)
        expect {
          described_class.new.perform(0)
        }.not_to raise_error
      end

      it "does nothing when there is no WhatsApp messaging integration" do
        allow(WhatsappMessagingIntegration).to receive(:find_by).with(hub: hub).and_return(nil)

        expect(whatsapp_service_double).not_to receive(:send_typing_indicator)
        described_class.new.perform(incoming_message.id)
      end

      it "logs instead of raising when the WhatsApp API call fails" do
        allow(whatsapp_service_double).to receive(:send_typing_indicator).and_raise(WhatsappService::Error.new("API error"))
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(incoming_message.id)
        }.not_to raise_error

        expect(LogService).to have_received(:log).with(:error, "TypingIndicatorWorker", "Failed to send typing indicator for message #{incoming_message.id}: API error")
      end
    end

    context "for a Telegram conversation" do
      let(:telegram_service_double) { instance_double(TelegramService) }
      let(:conversation) { create(:conversation, hub: hub, platform: "telegram", participant: create(:external_user, platform: "telegram", external_id: "chat123")) }
      let(:incoming_message) { create(:message, :incoming, conversation: conversation, external_id: "42") }

      before do
        allow(TelegramService).to receive(:new).with("bot_token").and_return(telegram_service_double)
        allow(telegram_service_double).to receive(:set_webhook).and_return(double("response", success?: true))
        allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))
        create(:telegram_messaging_integration, hub: hub, credentials: {bot_token: "bot_token"})
      end

      it "sends the typing chat action to the conversation chat" do
        expect(telegram_service_double).to receive(:send_chat_action).with(chat_id: "chat123").and_return(double("response", success?: true))

        described_class.new.perform(incoming_message.id)
      end

      it "does nothing when a reply already exists" do
        create(:message, :outgoing, conversation: conversation, reply_to: incoming_message)

        expect(telegram_service_double).not_to receive(:send_chat_action)
        described_class.new.perform(incoming_message.id)
      end

      it "does nothing when there is no Telegram messaging integration" do
        allow(TelegramMessagingIntegration).to receive(:find_by).with(hub: hub).and_return(nil)

        expect(telegram_service_double).not_to receive(:send_chat_action)
        described_class.new.perform(incoming_message.id)
      end

      it "logs when the Telegram API call fails" do
        allow(telegram_service_double).to receive(:send_chat_action).and_return(double("response", success?: false, body: "Error"))
        allow(LogService).to receive(:log)

        described_class.new.perform(incoming_message.id)

        expect(LogService).to have_received(:log).with(:error, "TypingIndicatorWorker", "Failed to send typing indicator for message #{incoming_message.id} to Telegram: Error")
      end
    end

    context "for a Signal conversation" do
      let(:signal_service_double) { instance_double(SignalService) }
      let(:conversation) { create(:conversation, hub: hub, platform: "signal", participant: create(:external_user, hub: hub, platform: "signal", external_id: "user-uuid")) }
      let(:incoming_message) { create(:message, :incoming, conversation: conversation, external_id: "1791466992147") }

      before do
        allow(SignalService).to receive(:new).with("+15555550100").and_return(signal_service_double)
        create(:signal_messaging_integration, hub: hub, active: true)
      end

      it "sends the typing indicator to the user" do
        expect(signal_service_double).to receive(:send_typing).with(recipient: "user-uuid")

        described_class.new.perform(incoming_message.id)
      end

      it "logs instead of raising when signal-cli fails" do
        allow(signal_service_double).to receive(:send_typing).and_raise(SignalService::Error, "Unregistered user")
        allow(LogService).to receive(:log)

        described_class.new.perform(incoming_message.id)

        expect(LogService).to have_received(:log).with(:error, "TypingIndicatorWorker", "Failed to send typing indicator for message #{incoming_message.id}: Unregistered user")
      end
    end

    context "for an SMS conversation" do
      let(:hub) { create(:hub, custom_limits: {"sms" => true}) }
      let(:provider) { instance_double(SmsProviders::Twilio) }
      let(:external_user) { create(:external_user, hub: hub, platform: "sms", external_id: "+15557778888") }
      let(:conversation) { create(:conversation, hub: hub, platform: "sms", participant: external_user) }
      let(:incoming_message) { create(:message, :incoming, conversation: conversation, external_id: "SM1") }

      before { allow(SmsProviders).to receive(:for).and_return(provider) }

      it "sends an RCS typing indicator when RCS is enabled" do
        create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}, settings: {rcs_agent_id: "acme_agent"})

        expect(provider).to receive(:send_typing_indicator).with(to: "+15557778888")
        described_class.new.perform(incoming_message.id)
      end

      it "does nothing when RCS is not enabled on the integration" do
        create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"})

        expect(provider).not_to receive(:send_typing_indicator)
        described_class.new.perform(incoming_message.id)
      end

      context "when the RCS typing indicator can't be delivered" do
        before do
          create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}, settings: {rcs_agent_id: "acme_agent"})
          allow(provider).to receive(:send_typing_indicator).and_raise(SmsProviders::Base::Error.new("agent not launched"))
          allow(LogService).to receive(:log)
          incoming_message # create it first so its own acknowledgement isn't counted below
        end

        it "falls back to an intermediary message for the acknowledgement" do
          expect { described_class.new.perform(incoming_message.id, true) }
            .to change { conversation.messages.outgoing.where(state: :bot_processing).count }.by(1)
        end

        it "does not create an intermediary message on a periodic re-fire" do
          expect { described_class.new.perform(incoming_message.id, false) }
            .not_to change { conversation.messages.outgoing.count }
        end
      end
    end
  end

  describe ".supports?" do
    it "returns true for whatsapp, telegram and signal conversations" do
      expect(described_class.supports?(build(:conversation, platform: "whatsapp"))).to be true
      expect(described_class.supports?(build(:conversation, platform: "telegram"))).to be true
      expect(described_class.supports?(build(:conversation, platform: "signal"))).to be true
    end

    it "returns true for an sms conversation only when its integration has RCS enabled" do
      hub = create(:hub, custom_limits: {"sms" => true})
      external_user = create(:external_user, hub: hub, platform: "sms", external_id: "+15557778888")
      sms_conversation = create(:conversation, hub: hub, platform: "sms", participant: external_user)
      expect(described_class.supports?(sms_conversation)).to be false

      create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}, settings: {rcs_agent_id: "acme_agent"})
      expect(described_class.supports?(sms_conversation)).to be true
    end

    it "returns false for other platforms" do
      expect(described_class.supports?(build(:conversation, platform: "internal"))).to be false
    end
  end
end
