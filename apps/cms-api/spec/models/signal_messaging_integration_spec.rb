require "rails_helper"

RSpec.describe SignalMessagingIntegration, type: :model do
  let(:signal_service) { instance_double(SignalService) }
  let(:link_uri) { "sgnl://linkdevice?uuid=abc&pub_key=def" }
  let(:integration) { described_class.create!(hub: create(:hub), active: false) }

  before do
    allow(SignalService).to receive(:new).and_return(signal_service)
    allow(signal_service).to receive(:start_link).and_return(link_uri)
  end

  it "exposes the phone number once connected" do
    integration = create(:signal_messaging_integration, active: true)

    expect(integration.as_json).to include("phone_number" => "+15555550100")
    expect(integration.as_json).not_to have_key("signal_link")
  end

  describe "#complete_link!" do
    it "stores the linked number and activates the integration" do
      allow(signal_service).to receive(:finish_link).with(link_uri, "Suwali").and_return("+15555550100")

      integration.complete_link!

      expect(integration.reload).to have_attributes(active: true)
      expect(integration.get_credential(:phone_number)).to eq("+15555550100")
      expect(integration.get_credential(:link_uri)).to be_nil
      expect(described_class.for_account("+15555550100")).to eq(integration)
    end

    it "marks the link as failed when the QR code isn't scanned in time" do
      allow(signal_service).to receive(:finish_link).and_raise(SignalService::Error, "timeout")

      integration.complete_link!

      expect(integration.reload).to have_attributes(active: false)
      expect(integration.as_json["signal_link"]["status"]).to eq("failed")
    end

    it "marks the link as failed when the number is already connected to another hub" do
      create(:signal_messaging_integration, active: true, credentials: {"phone_number" => "+15555550100"})
      allow(signal_service).to receive(:finish_link).and_return("+15555550100")

      integration.complete_link!

      expect(integration.reload).to have_attributes(active: false)
      expect(integration.get_setting(:link_status)).to eq("failed")
    end

    it "deletes the linked account's local data when the integration was removed meanwhile" do
      allow(signal_service).to receive(:finish_link).and_return("+15555550100")
      allow(signal_service).to receive(:delete_local_account_data)
      described_class.where(id: integration.id).delete_all

      integration.complete_link!

      expect(signal_service).to have_received(:delete_local_account_data)
    end

    it "keeps the account's data when another hub uses that number" do
      allow(signal_service).to receive(:finish_link).and_return("+15555550100")
      allow(signal_service).to receive(:delete_local_account_data)
      described_class.where(id: integration.id).delete_all
      create(:signal_messaging_integration, active: true)

      integration.complete_link!

      expect(signal_service).not_to have_received(:delete_local_account_data)
    end
  end

  describe "when destroyed" do
    it "deletes the account's data from signal-cli" do
      connected = create(:signal_messaging_integration, active: true)

      expect { connected.destroy! }.to change(SignalAccountDeletionWorker.jobs, :size).by(1)
      expect(SignalAccountDeletionWorker.jobs.last["args"]).to eq(["+15555550100"])
    end

    it "keeps the data while another integration uses the same number" do
      connected = create(:signal_messaging_integration, active: true)
      described_class.new(hub: create(:hub), active: false, credentials: {"phone_number" => "+15555550100"}).save!(validate: false)

      expect { connected.destroy! }.not_to change(SignalAccountDeletionWorker.jobs, :size)
    end
  end
end
