require "rails_helper"

RSpec.describe MessageSenderWorker, type: :worker do
  let!(:telegram_service_double) { instance_double(MessageSenderServices::TelegramService) }
  let!(:whatsapp_service_double) { instance_double(MessageSenderServices::WhatsappService) }
  let!(:sms_service_double) { instance_double(MessageSenderServices::SmsService) }
  let!(:signal_service_double) { instance_double(MessageSenderServices::SignalService) }

  before do
    allow(MessageSenderServices::TelegramService).to receive(:new).and_return(telegram_service_double)
    allow(MessageSenderServices::WhatsappService).to receive(:new).and_return(whatsapp_service_double)
    allow(MessageSenderServices::SmsService).to receive(:new).and_return(sms_service_double)
    allow(MessageSenderServices::SignalService).to receive(:new).and_return(signal_service_double)
  end

  it "performs for outgoing Telegram message" do
    expect(telegram_service_double).to receive(:send_message)
    message = create(:message, :outgoing, conversation: create(:conversation, platform: "telegram"))
    described_class.new.perform(message.id)
  end

  it "performs for outgoing WhatsApp message" do
    expect(whatsapp_service_double).to receive(:send_message)
    message = create(:message, :outgoing, conversation: create(:conversation, platform: "whatsapp"))
    described_class.new.perform(message.id)
  end

  it "performs for outgoing SMS message" do
    expect(sms_service_double).to receive(:send_message)
    message = create(:message, :outgoing, conversation: create(:conversation, platform: "sms"))
    described_class.new.perform(message.id)
  end

  it "performs for outgoing Signal message" do
    expect(signal_service_double).to receive(:send_message)
    message = create(:message, :outgoing, conversation: create(:conversation, platform: "signal"))
    described_class.new.perform(message.id)
  end

  it "returns for incoming message" do
    expect(telegram_service_double).not_to receive(:send_message)
    message = create(:message, :incoming, conversation: create(:conversation, platform: "internal"))
    described_class.new.perform(message.id)
  end

  it "returns for unsupported platform" do
    expect(telegram_service_double).not_to receive(:send_message)
    message = create(:message, :outgoing, conversation: create(:conversation, platform: "internal"))
    described_class.new.perform(message.id)
  end

  it "raises for error" do
    expect { described_class.new.perform(0) }.to raise_error(ActiveRecord::RecordNotFound)
  end
end
