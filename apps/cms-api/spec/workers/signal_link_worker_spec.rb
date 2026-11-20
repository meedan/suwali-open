require "rails_helper"

RSpec.describe SignalLinkWorker, type: :worker do
  it "completes linking for the integration" do
    integration = create(:signal_messaging_integration)
    allow(SignalMessagingIntegration).to receive(:find_by).with(id: integration.id).and_return(integration)
    expect(integration).to receive(:complete_link!)

    described_class.new.perform(integration.id)
  end

  it "does nothing when the integration no longer exists" do
    expect { described_class.new.perform(0) }.not_to raise_error
  end
end
