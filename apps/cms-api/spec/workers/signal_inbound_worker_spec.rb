require "rails_helper"

RSpec.describe SignalInboundWorker, type: :worker do
  it "hands the parsed event to the Signal webhook service" do
    event = {"envelope" => {"sourceUuid" => "uuid"}, "account" => "+15555550100"}
    service = instance_double(WebhookServices::SignalService)
    expect(WebhookServices::SignalService).to receive(:new).with(event).and_return(service)
    expect(service).to receive(:process)

    described_class.new.perform(event.to_json)
  end
end
