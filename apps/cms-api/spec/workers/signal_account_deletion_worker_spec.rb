require "rails_helper"

RSpec.describe SignalAccountDeletionWorker, type: :worker do
  let(:signal_service) { instance_double(SignalService, delete_local_account_data: {}) }

  before { allow(SignalService).to receive(:new).with("+15555550100").and_return(signal_service) }

  it "deletes the account's local data from signal-cli" do
    described_class.new.perform("+15555550100")

    expect(signal_service).to have_received(:delete_local_account_data)
  end

  it "keeps the data if the number was connected to a hub again" do
    create(:signal_messaging_integration, active: true)

    described_class.new.perform("+15555550100")

    expect(signal_service).not_to have_received(:delete_local_account_data)
  end
end
