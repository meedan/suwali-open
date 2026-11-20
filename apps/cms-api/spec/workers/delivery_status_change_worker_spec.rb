require "rails_helper"

RSpec.describe DeliveryStatusChangeWorker, type: :worker do
  it "updates the message status when a message is found" do
    message = create(:message, :outgoing, external_id: "uid")
    expect {
      described_class.new.perform(message.external_id, "delivered", nil)
    }.to change { message.reload.status }.from("sent").to("delivered")
  end

  it "stores the delivery error when a message fails" do
    message = create(:message, :outgoing, external_id: "uid")
    allow(LogService).to receive(:log)
    described_class.new.perform(message.external_id, "failed", {"code" => 131026, "message" => "Message undeliverable"})
    expect(message.reload).to be_failed
    expect(message.metadata["delivery_error"]).to eq("code" => "131026", "message" => "Message undeliverable")
  end

  it "does not store an empty delivery error when the callback carries none" do
    message = create(:message, :outgoing, external_id: "uid")
    allow(LogService).to receive(:log)
    described_class.new.perform(message.external_id, "failed", nil)
    expect(message.reload).to be_failed
    expect(message.metadata).not_to have_key("delivery_error")
  end

  it "clears the delivery error when a failed message is later delivered" do
    message = create(:message, :outgoing, external_id: "uid", status: :failed, metadata: {"delivery_error" => {"code" => "30008"}, "other" => 1})
    described_class.new.perform(message.external_id, "delivered", nil)
    expect(message.reload.metadata).to eq("other" => 1)
  end

  it "raises SentMessageNotFound so Sidekiq can retry, if no message is found" do
    expect {
      described_class.new.perform("this_id_does_not_exist", "delivered", nil)
    }.to raise_error(described_class::SentMessageNotFound)
  end

  it "does not regress a delivered message when a stale failed callback arrives later" do
    message = create(:message, :outgoing, external_id: "uid", status: :delivered)
    expect {
      described_class.new.perform(message.external_id, "failed", nil)
    }.not_to change { message.reload.status }
  end

  it "allows a failed message to self-correct to delivered (providers report this out-of-order pattern)" do
    message = create(:message, :outgoing, external_id: "uid", status: :failed)
    expect {
      described_class.new.perform(message.external_id, "delivered", nil)
    }.to change { message.reload.status }.from("failed").to("delivered")
  end

  it "is a no-op, not an error, when a duplicate callback repeats the message's current status" do
    message = create(:message, :outgoing, external_id: "uid", status: :delivered)
    expect {
      described_class.new.perform(message.external_id, "delivered", nil)
    }.not_to change { message.reload.status }
  end

  it "does not log again when a duplicate failed callback repeats the message's current status" do
    message = create(:message, :outgoing, external_id: "uid", status: :failed)
    expect(LogService).not_to receive(:log)
    described_class.new.perform(message.external_id, "failed", nil)
  end

  it "is a no-op when Twilio's sent-confirmation statuses (queued/sending/accepted/sent) echo back on an already-sent message" do
    message = create(:message, :outgoing, external_id: "uid", status: :sent)
    expect {
      described_class.new.perform(message.external_id, "sent", nil)
    }.not_to change { message.reload.status }
  end
end
