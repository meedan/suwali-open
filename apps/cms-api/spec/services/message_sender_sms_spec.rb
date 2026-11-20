require "rails_helper"

RSpec.describe MessageSenderServices::SmsService, type: :service do
  let!(:hub) { create(:hub, custom_limits: {"sms" => true}) }
  let!(:external_user) { create(:external_user, hub: hub, platform: "sms", external_id: "+15557778888") }
  let!(:conversation) { create(:conversation, hub: hub, platform: "sms", participant: external_user) }
  let!(:message) { create(:message, :outgoing, conversation: conversation, body: "Here is your answer") }
  let!(:integration) { create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}) }
  let(:provider) { instance_double(SmsProviders::Twilio) }

  before do
    allow(SmsProviders).to receive(:for).and_return(provider)
    allow_any_instance_of(SmsMessagingIntegration).to receive(:approved_for_sending?).and_return(true)
  end

  it "sends a plain message and records status + external id" do
    expect(provider).to receive(:deliver)
      .with(to: "+15557778888", body: "Here is your answer", status_callback_url: end_with("/api/webhooks/sms/#{integration.id}"))
      .and_return(external_id: "SM99", status: :sent)

    described_class.new(message).send_message

    expect(message.reload.status).to eq("sent")
    expect(message.external_id).to eq("SM99")
  end

  it "returns early when there is no sms integration" do
    allow(SmsMessagingIntegration).to receive(:find_by).with(hub: hub, active: true).and_return(nil)
    expect(provider).not_to receive(:deliver)
    described_class.new(message).send_message
  end

  it "does not send through a deactivated integration" do
    integration.update!(active: false)
    expect(provider).not_to receive(:deliver)
    described_class.new(message).send_message
  end

  it "does not send when the number is not approved to send" do
    allow_any_instance_of(SmsMessagingIntegration).to receive(:approved_for_sending?).and_return(false)
    allow(LogService).to receive(:log)
    expect(provider).not_to receive(:deliver)

    described_class.new(message).send_message

    expect(message.reload.status).to eq("failed")
    expect(LogService).to have_received(:log).with(:info, "MessageSenderServices::SmsService", /registration_not_approved/)
  end

  it "does not send to an opted-out recipient" do
    external_user.update!(opted_out_at: Time.now)
    allow(LogService).to receive(:log)
    expect(provider).not_to receive(:deliver)

    described_class.new(message).send_message

    expect(message.reload.status).to eq("failed")
    expect(LogService).to have_received(:log).with(:info, "MessageSenderServices::SmsService", /recipient_opted_out/)
  end

  it "marks the message failed and logs on exception" do
    allow(provider).to receive(:deliver).and_raise(StandardError.new("boom"))
    allow(LogService).to receive(:log)

    described_class.new(message).send_message

    expect(message.reload.status).to eq("failed")
    expect(LogService).to have_received(:log).with(:error, "MessageSenderServices::SmsService", /Exception on sending message #{message.id} to SMS: boom/)
  end

  it "stores only the provider's error code, not the raw error body" do
    allow(provider).to receive(:deliver).and_raise(SmsProviders::Base::Error.new("Send failed: The 'To' number +15557778888 is not valid", 21211))
    allow(LogService).to receive(:log)

    described_class.new(message).send_message

    expect(message.reload.metadata["delivery_error"]).to eq("code" => "21211")
  end

  it "names the hub and adds opt-out instructions to topic notifications" do
    hub.update!(name: "Election Desk")
    message.update!(state: :topic_notification, body: "Update on Elections")
    allow(message).to receive(:interactive_buttons).and_return([{id: "unsubscribe_7", text: "Unsubscribe", type: "unsubscribe"}])
    expect(provider).to receive(:deliver) do |args|
      expect(args[:body]).to eq("Election Desk: Update on Elections\n\nReply STOP to stop all messages.\n\nReply \"1\" to Unsubscribe.")
      {external_id: "SM1", status: :sent}
    end

    described_class.new(message).send_message
  end

  describe "body length" do
    it "truncates bodies beyond Twilio's 1600-character limit" do
      message.update!(body: "a" * 2000)
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body].length).to eq(1600)
        expect(args[:body]).to end_with("...")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message
    end

    # Real LLM answer that Twilio rejected (21617); Smart Encoding on the messaging service rewrites "…" as "..."
    it "stays within the limit after Twilio's Smart Encoding" do
      message.update!(body: <<~BODY.chomp)
        The five ballot proposals from the New York City Commission on Government Efficiency (COGE) aim to improve city operations. Here are the proposals along with their pros and cons:

        1. **Speed Up Process for Granting a Revocable Consent to Use Public Spaces**: This proposal simplifies the process for businesses to use public spaces for outdoor dining and accessibility ramps.
        - **Pros**: Saves time and money for small businesses.
        - **Cons**: Critics may argue it reduces public input by making hearings optional.

        2. **Reduce City Contractor Paperwork**: This proposal requires regular meetings of the Procurement Policy Board and allows changes to vendor questionnaires.
        - **Pros**: Streamlines contracting processes.
        - **Cons**: Some may worry it could lead to less oversight.

        3. **Speed Up Street Safety Projects**: This proposal changes the approval process for bike lanes and road redesigns.
        - **Pros**: Aims to enhance street safety more quickly.
        - **Cons**: Potential concerns about insufficient community engagement in planning.

        4. **Simplify Building Permitting**: This proposal creates a single online hub for construction permits and moves waterfront permitting to the Department of Buildings.
        - **Pros**: Makes the permitting process more efficient.
        - **Cons**: There may be concerns about the adequacy of the new system.

        5. **Establish a Rainy-Day Fund**: This proposal aims to create financial reserves for emergencies.
        - **Pros**: Provides a safety net during economic downturns.
        - **Cons**: Critics might argue about the implications for current budget allocations.

        These proposals reflect feedback from public hearings where residents expressed frustrations with city processes. The effectiveness of these changes will depend on implementation and community response.
      BODY
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body].length).to eq(1600)
        expect(args[:body]).to be_ascii_only
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message
    end

    # Snippets in a sources reply end in "…"; each one grew by two characters at Twilio
    it "counts ellipses inside the body as Twilio will send them" do
      message.update!(body: "#{"a" * 100}…\n" * 20)
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body].length).to eq(1600)
        expect(args[:body]).not_to include("…")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message
    end

    it "leaves short bodies untouched" do
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body]).to eq("Here is your answer")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message
    end

    it "truncates only the body, keeping numbered option lines intact" do
      message.update!(body: "a" * 2000)
      allow(message).to receive(:interactive_buttons).and_return([{id: "unsubscribe_7", text: "Unsubscribe", type: "unsubscribe"}])
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body].length).to eq(1600)
        expect(args[:body]).to end_with("...\n\nReply \"1\" to Unsubscribe.")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message

      expect(message.reload.metadata["sms_options"]).to eq("1" => "unsubscribe_7")
    end
  end

  describe "interactive options degraded to numbered instructions" do
    before do
      allow(message).to receive(:interactive_buttons).and_return([
        {id: "see_sources_#{message.id}", text: "See sources", type: "sources"},
        {id: "unsubscribe_7", text: "Unsubscribe", type: "unsubscribe"}
      ])
    end

    it "appends numbered instructions and stores the option map for reply parsing" do
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body]).to eq("Here is your answer\n\nReply \"1\" to See sources.\nReply \"2\" to Unsubscribe.")
        expect(args).not_to have_key(:buttons)
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message

      expect(message.reload.metadata["sms_options"]).to eq("1" => "see_sources_#{message.id}", "2" => "unsubscribe_7")
    end
  end

  describe "RCS enabled" do
    let(:buttons) { [{id: "see_sources_#{message.id}", text: "See sources", type: "sources"}] }

    before do
      allow_any_instance_of(SmsMessagingIntegration).to receive(:rcs_enabled?).and_return(true)
      allow(message).to receive(:interactive_buttons).and_return(buttons)
    end

    it "sends the buttons as quick replies with the numbered text as SMS fallback" do
      expect(provider).to receive(:deliver) do |args|
        expect(args[:body]).to eq("Here is your answer")
        expect(args[:buttons]).to eq(buttons)
        expect(args[:fallback_text]).to eq("Here is your answer\n\nReply \"1\" to See sources.")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message

      # The option map is still stored so the SMS-fallback numbered reply remains routable.
      expect(message.reload.metadata["sms_options"]).to eq("1" => "see_sources_#{message.id}")
    end

    it "sends a plain message (no buttons) when the message has none" do
      allow(message).to receive(:interactive_buttons).and_return(nil)
      expect(provider).to receive(:deliver) do |args|
        expect(args).not_to have_key(:buttons)
        expect(args[:body]).to eq("Here is your answer")
        {external_id: "SM1", status: :sent}
      end

      described_class.new(message).send_message
    end
  end
end
