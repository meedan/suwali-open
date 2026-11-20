require "rails_helper"

RSpec.describe WebhookServices::SmsService, type: :service do
  let!(:integration) { create(:sms_messaging_integration, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}) }
  let(:provider) { instance_double(SmsProviders::Twilio) }
  # request_parameters drives the inbound-vs-status-callback branch (MessageStatus present ⇒ status);
  # defaults to inbound (no MessageStatus), overridden in the delivery-status describe.
  let(:request_params) { {} }
  let(:request) { instance_double(ActionDispatch::Request, request_parameters: request_params) }

  before { allow(SmsProviders).to receive(:for).with(integration).and_return(provider) }

  def inbound(overrides = {})
    {from: "+15557778888", to: "+15550001111", body: "hello", external_id: "SM1", raw: {"From" => "+15557778888"}}.merge(overrides)
  end

  describe "#valid?" do
    it "is false when the integration is missing" do
      expect(described_class.new(999_999).valid?(request)).to be(false)
    end

    it "is false when the signature is invalid" do
      allow(provider).to receive(:verify_signature).with(request).and_return(false)
      expect(described_class.new(integration.id).valid?(request)).to be(false)
    end

    it "is false when the destination number does not match this integration" do
      allow(provider).to receive(:verify_signature).and_return(true)
      allow(provider).to receive(:parse_inbound).and_return(inbound(to: "+19999999999"))
      expect(described_class.new(integration.id).valid?(request)).to be(false)
    end

    it "is true for a signed message to this integration's number" do
      allow(provider).to receive(:verify_signature).and_return(true)
      allow(provider).to receive(:parse_inbound).and_return(inbound)
      expect(described_class.new(integration.id).valid?(request)).to be(true)
    end

    context "RCS-addressed inbound (To = agent id, not the number)" do
      before do
        allow(provider).to receive(:verify_signature).and_return(true)
        integration.set_setting(:rcs_agent_id, "acme_agent")
        integration.save!
      end

      it "is valid when addressed to the integration's RCS agent id" do
        allow(provider).to receive(:parse_inbound).and_return(inbound(to: "acme_agent"))
        expect(described_class.new(integration.id).valid?(request)).to be(true)
      end

      it "is false when addressed to a different agent" do
        allow(provider).to receive(:parse_inbound).and_return(inbound(to: "someone_else_agent"))
        expect(described_class.new(integration.id).valid?(request)).to be(false)
      end

      it "processes the message under the sender's bare (SMS-equivalent) identity" do
        allow(provider).to receive(:parse_inbound).and_return(inbound(to: "acme_agent", from: "+15557779999"))

        expect { described_class.new(integration.id).process(request) }.to change { Message.incoming.count }.by(1)
        expect(ExternalUser.last.external_id).to eq("+15557779999")
      end
    end
  end

  describe "#process" do
    before { allow(provider).to receive(:verify_signature).and_return(true) }

    def run(overrides = {})
      allow(provider).to receive(:parse_inbound).and_return(inbound(overrides))
      described_class.new(integration.id).process(request)
    end

    it "creates a user, conversation and incoming message for a normal message" do
      expect { run }.to change(ExternalUser, :count).by(1)
        .and change(Conversation, :count).by(1)
        .and change { Message.incoming.count }.by(1)

      user = ExternalUser.last
      expect(user.platform).to eq("sms")
      expect(user.external_id).to eq("+15557778888")
    end

    it "continues the sender's existing conversation" do
      run

      expect { run(external_id: "SM2") }.not_to change(Conversation, :count)
      expect(Conversation.last.messages.incoming.count).to eq(2)
    end

    it "starts a new conversation when the sender's previous one is waiting to be deleted" do
      run
      previous = Conversation.last
      previous.update!(deleted_at: Time.current)

      run(external_id: "SM2")

      current = Conversation.not_deleted.last
      expect(current).not_to eq(previous)
      expect(current.messages.incoming.count).to eq(1)
    end

    it "opts out on STOP without starting a conversation or replying" do
      expect { run(body: "Stop") }.to change(ExternalUser, :count).by(1)
        .and change(Conversation, :count).by(0)
        .and change(Message, :count).by(0)
      expect(ExternalUser.last).to be_opted_out
    end

    it "opts back in on START" do
      user = create(:external_user, hub: integration.hub, platform: "sms", external_id: "+15557778888", opted_out_at: Time.now)
      expect { run(body: "START") }.to change { user.reload.opted_out? }.from(true).to(false)
      expect(Conversation.count).to eq(0)
    end

    it "never engages an opted-out user for a normal message" do
      create(:external_user, hub: integration.hub, platform: "sms", external_id: "+15557778888", opted_out_at: Time.now)
      expect { run(body: "when is the election?") }.to change(Message, :count).by(0)
        .and change(Conversation, :count).by(0)
    end

    it "no-ops on HELP (carrier auto-responds)" do
      expect { run(body: "help") }.to change(Message, :count).by(0).and change(Conversation, :count).by(0)
    end

    it "replies with the unsupported-message notice when the body is blank (media-only MMS)" do
      expect { run(body: "") }.to change { Message.where(state: :unsupported_message).count }.by(1)
        .and change { Message.incoming.count }.by(0)
    end
  end

  describe "reply parsing (numbered options)" do
    let!(:external_user) { create(:external_user, hub: integration.hub, platform: "sms", external_id: "+15557778888") }
    let!(:conversation) { create(:conversation, hub: integration.hub, platform: "sms", participant: external_user) }

    before { allow(provider).to receive(:verify_signature).and_return(true) }

    it "translates a numbered reply into the stored callback flow instead of a plain message" do
      create(:message, :outgoing, conversation: conversation, metadata: {"sms_options" => {"1" => "see_sources_5"}})
      allow(provider).to receive(:parse_inbound).and_return(inbound(body: "1"))

      expect_any_instance_of(described_class).to receive(:handle_button_callback).with("see_sources_5", conversation, anything)
      expect {
        described_class.new(integration.id).process(request)
      }.not_to change { Message.incoming.count }
    end

    it "treats a numbered reply as a normal message when no options were offered" do
      allow(provider).to receive(:parse_inbound).and_return(inbound(body: "1"))
      expect {
        described_class.new(integration.id).process(request)
      }.to change { Message.incoming.count }.by(1)
    end
  end

  describe "reply parsing (RCS quick-reply taps)" do
    let!(:external_user) { create(:external_user, hub: integration.hub, platform: "sms", external_id: "+15557778888") }
    let!(:conversation) { create(:conversation, hub: integration.hub, platform: "sms", participant: external_user) }

    before { allow(provider).to receive(:verify_signature).and_return(true) }

    it "routes a ButtonPayload tap straight into the button-callback flow" do
      allow(provider).to receive(:parse_inbound).and_return(inbound(button_payload: "see_sources_5"))

      expect_any_instance_of(described_class).to receive(:handle_button_callback).with("see_sources_5", conversation, anything)
      expect {
        described_class.new(integration.id).process(request)
      }.not_to change { Message.incoming.count }
    end

    it "treats an ordinary message (no ButtonPayload) as a normal message" do
      allow(provider).to receive(:parse_inbound).and_return(inbound(body: "hello there"))
      expect {
        described_class.new(integration.id).process(request)
      }.to change { Message.incoming.count }.by(1)
    end
  end

  # Inbound and delivery-status callbacks share one endpoint; a MessageStatus param routes to the
  # status branch (mirrors the WhatsApp webhook handling both messages and statuses).
  describe "delivery-status callback" do
    let!(:external_user) { create(:external_user, hub: integration.hub, platform: "sms", external_id: "+15557778888") }
    let!(:conversation) { create(:conversation, hub: integration.hub, platform: "sms", participant: external_user) }
    let!(:sent_message) { create(:message, :outgoing, conversation: conversation, external_id: "SM1", status: :sent) }
    let(:request_params) { {"MessageSid" => "SM1", "MessageStatus" => "delivered"} }

    before { allow(provider).to receive(:verify_signature).and_return(true) }

    it "is valid on a good signature alone (no destination-number match required)" do
      expect(described_class.new(integration.id).valid?(request)).to be(true)
    end

    it "hands off the matching message's delivery status and error" do
      allow(provider).to receive(:handle_status_callback).with(request_params).and_return(external_id: "SM1", status: :failed, error: {code: "30008", message: "Unknown error"})
      service = described_class.new(integration.id)
      expect(service).to receive(:process_delivery_status_change).with("SM1", "failed", {code: "30008", message: "Unknown error"})
      service.process(request)
    end

    it "does nothing when the provider reports no trackable status" do
      allow(provider).to receive(:handle_status_callback).and_return(nil)
      service = described_class.new(integration.id)
      expect(service).not_to receive(:process_delivery_status_change)
      service.process(request)
    end

    it "does not hand off a sent-confirmation status (queued/sending/accepted/sent)" do
      allow(provider).to receive(:handle_status_callback).with(request_params).and_return(external_id: "SM1", status: :sent)
      service = described_class.new(integration.id)
      expect(service).not_to receive(:process_delivery_status_change)
      service.process(request)
    end
  end
end
