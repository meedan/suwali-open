require "rails_helper"

RSpec.describe WebhookServices::SignalService, type: :service do
  let!(:integration) { create(:signal_messaging_integration, active: true) }
  let(:user_uuid) { "22222222-2222-4222-8222-222222222222" }

  def signal_event(name)
    JSON.parse(File.read(Rails.root.join("spec/files/signal/#{name}.json")))
  end

  def process(name)
    described_class.new(signal_event(name)).process
  end

  it "creates the user, conversation and message for an incoming text" do
    expect { process("text") }.to change(ExternalUser, :count).by(1)
      .and change(Conversation, :count).by(1)
      .and change(Message.incoming, :count).by(1)

    external_user = ExternalUser.last
    expect(external_user).to have_attributes(hub_id: integration.hub_id, platform: "signal", external_id: user_uuid, display_name: "Test User")
    expect(Message.incoming.last).to have_attributes(body: "hello bot", external_id: "#{Conversation.last.id}:1791466992147")
  end

  it "doesn't duplicate a message replayed after the listener reconnects" do
    process("text")
    expect { process("text") }.not_to change(Message, :count)
  end

  it "links a quote reply to the bot message it quotes" do
    process("text")
    conversation = Conversation.last
    bot_message = create(:message, :outgoing, conversation: conversation, external_id: "#{conversation.id}:1791467007267")

    process("quote_reply")

    expect(Message.incoming.find_by!(external_id: "#{conversation.id}:1791468212649").metadata["replied_to_message_id"]).to eq(bot_message.id)
  end

  it "routes a numbered reply to the option it selects instead of treating it as a question" do
    process("text")
    conversation = Conversation.last
    create(:message, :outgoing, conversation: conversation, metadata: {"signal_options" => {"1" => "see_sources_999"}})
    event = signal_event("text")
    event["envelope"]["dataMessage"].merge!("message" => "1", "timestamp" => 1791466999999)

    expect { described_class.new(event).process }.not_to change(conversation.messages.incoming, :count)
    expect(conversation.messages.outgoing.pluck(:body)).to include(I18n.t(:message_sources_not_available))
  end

  it "handles a replayed numbered reply only once" do
    process("text")
    conversation = Conversation.last
    create(:message, :outgoing, conversation: conversation, metadata: {"signal_options" => {"1" => "see_sources_999"}})
    event = signal_event("text")
    event["envelope"]["dataMessage"].merge!("message" => "1", "timestamp" => 1791466999999)
    handled = false
    allow(Rails.cache).to receive(:exist?).and_call_original
    allow(Rails.cache).to receive(:exist?).with("signal_option_reply/#{conversation.id}:1791466999999") { handled }
    allow(Rails.cache).to receive(:write).and_call_original
    allow(Rails.cache).to receive(:write).with("signal_option_reply/#{conversation.id}:1791466999999", true, expires_in: 1.day) { handled = true }

    expect {
      2.times { described_class.new(event).process }
    }.to change(conversation.messages.outgoing, :count).by(1)
  end

  it "answers media with the unsupported-message reply" do
    process("attachment")
    expect(Message.outgoing.where(state: :unsupported_message).count).to eq(1)
  end

  it "logs reactions without creating messages" do
    allow(LogService).to receive(:log)
    expect { process("reaction") }.not_to change(Message, :count)
    expect(LogService).to have_received(:log).with(:info, "WebhookServices::BaseService", /1791467007267: 👍/)
  end

  it "ignores sync, typing and disappearing-timer events" do
    %w[sync_sent_message sync_read_messages sync_empty typing_started expiration_update].each do |name|
      expect { process(name) }.not_to change(Message, :count)
    end
  end

  it "ignores events for accounts that aren't connected to a hub" do
    event = signal_event("text").merge("account" => "+15555559999")
    expect { described_class.new(event).process }.not_to change(Message, :count)
  end

  describe "delivery receipts" do
    before { process("text") }

    def bot_message(conversation)
      create(:message, :outgoing, conversation: conversation, external_id: "#{conversation.id}:1791467007267", status: :sent)
    end

    it "tracks delivery of the bot's message to that user" do
      conversation = Conversation.last
      bot_message(conversation)

      expect { process("receipt_delivery") }.to change(DeliveryStatusChangeWorker.jobs, :size).by(1)
      expect(DeliveryStatusChangeWorker.jobs.last["args"].first(2)).to eq(["#{conversation.id}:1791467007267", "delivered"])
    end

    it "looks again later for a message whose id isn't stored yet, but only once" do
      expect { process("receipt_delivery") }.to change(SignalInboundWorker.jobs, :size).by(1)

      retry_event = JSON.parse(SignalInboundWorker.jobs.last["args"].first)
      expect(retry_event).to include("receipt_retry" => true)
      expect(retry_event.dig("envelope", "receiptMessage", "timestamps")).to eq([1791467007267])

      bot_message(Conversation.last)
      SignalInboundWorker.jobs.clear
      expect { described_class.new(retry_event).process }.to change(DeliveryStatusChangeWorker.jobs, :size).by(1)
      expect(SignalInboundWorker.jobs).to be_empty
    end

    it "drops a retried receipt that still matches nothing, such as one for a message sent from the linked phone" do
      event = signal_event("receipt_delivery").merge("receipt_retry" => true)

      expect { described_class.new(event).process }.not_to change(SignalInboundWorker.jobs, :size)
    end

    it "skips receipts for messages the bot didn't send to that user" do
      other_user = create(:external_user, hub: integration.hub, platform: "signal", external_id: "33333333-3333-4333-8333-333333333333")
      bot_message(create(:conversation, hub: integration.hub, platform: "signal", participant: other_user))

      expect { process("receipt_delivery") }.not_to change(DeliveryStatusChangeWorker.jobs, :size)
    end

    it "ignores receipts for a deleted conversation and doesn't schedule a retry" do
      conversation = Conversation.last
      bot_message(conversation)
      conversation.update!(deleted_at: Time.current)

      expect { process("receipt_delivery") }.not_to change { [DeliveryStatusChangeWorker.jobs.size, SignalInboundWorker.jobs.size] }
    end

    it "ignores read receipts" do
      bot_message(Conversation.last)

      expect { process("receipt_read") }.not_to change(DeliveryStatusChangeWorker.jobs, :size)
    end
  end

  it "never routes one hub's events into another hub" do
    other_integration = create(:signal_messaging_integration, active: true, credentials: {"phone_number" => "+15555550111"})

    process("text")

    expect(other_integration.hub.external_users).to be_empty
    expect(Conversation.where(hub: other_integration.hub)).to be_empty
  end
end
