require "rails_helper"

RSpec.describe SignalEventListener, type: :service do
  let(:events_url) { "http://signal-cli:8080/api/v1/events" }
  let(:event_data) { {envelope: {sourceUuid: "uuid", dataMessage: {message: "hi"}}, account: "+15555550100"}.to_json }
  let(:typing_data) { {envelope: {sourceUuid: "uuid", typingMessage: {action: "STARTED"}}, account: "+15555550100"}.to_json }
  let(:stream_body) do
    ":\n\n" \
      "id:1791469655175-1\nevent:receive\ndata:#{event_data}\n\n" \
      "id:1791469655175-2\nevent:receive\ndata:#{typing_data}\n\n" \
      "id:1791469655175-3\nevent:other\ndata:{}\n\n"
  end

  let(:signal_service) { instance_double(SignalService, list_accounts: ["+15555550100"]) }

  before do
    allow(SignalService).to receive(:new).and_return(signal_service)
    allow(Rails.cache).to receive(:read).and_call_original
    allow(Rails.cache).to receive(:write).and_call_original
  end

  def stream
    described_class.new.send(:stream)
  end

  it "queues received messages, skips events nothing handles, and remembers the last event id" do
    stub_request(:get, events_url).to_return(status: 200, body: stream_body)

    expect { stream }.to change(SignalInboundWorker.jobs, :size).by(1)

    expect(SignalInboundWorker.jobs.last["args"]).to eq([event_data])
    expect(Rails.cache).to have_received(:write).with(described_class::LAST_EVENT_ID_KEY, "1791469655175-3")
  end

  it "skips an event whose data isn't valid JSON and keeps reading" do
    body = "id:1791469655175-1\nevent:receive\ndata:{not json\n\n" \
      "id:1791469655175-2\nevent:receive\ndata:#{event_data}\n\n"
    stub_request(:get, events_url).to_return(status: 200, body: body)

    expect { stream }.to change(SignalInboundWorker.jobs, :size).by(1)
    expect(SignalInboundWorker.jobs.last["args"]).to eq([event_data])
  end

  it "resumes from the last processed event" do
    allow(Rails.cache).to receive(:read).with(described_class::LAST_EVENT_ID_KEY).and_return("1791469655175-1")
    stub_request(:get, events_url).with(headers: {"Last-Event-ID" => "1791469655175-1"}).to_return(status: 200, body: "")

    stream

    expect(a_request(:get, events_url).with(headers: {"Last-Event-ID" => "1791469655175-1"})).to have_been_made
  end

  it "stops reading, so #run reconnects, when an account is linked or removed" do
    stub_const("#{described_class}::ACCOUNT_CHECK_INTERVAL", 0)
    allow(signal_service).to receive(:list_accounts).and_return(["+15555550100"], ["+15555550100", "+15555550199"])
    stub_request(:get, events_url).to_return(status: 200, body: stream_body)

    expect { stream }.to change(SignalInboundWorker.jobs, :size).by(1)
    expect(signal_service).to have_received(:list_accounts).twice
  end

  it "logs an interrupted stream and reconnects after a delay" do
    listener = described_class.new
    allow(listener).to receive(:stream).and_raise("connection refused")
    # Ends the otherwise endless loop after the first attempt
    allow(listener).to receive(:sleep).with(described_class::RECONNECT_DELAY).and_raise(StopIteration)
    allow(LogService).to receive(:log)

    listener.run

    expect(LogService).to have_received(:log).with(:warn, "SignalEventListener", "Signal event stream interrupted: connection refused")
  end

  it "stops quietly when the process is terminated" do
    listener = described_class.new
    allow(listener).to receive(:stream).and_raise(SignalException, "TERM")
    allow(listener).to receive(:sleep)

    expect { listener.run }.not_to raise_error
  end

  it "raises on an unexpected response, so #run reconnects" do
    stub_request(:get, events_url).to_return(status: 503)

    expect { stream }.to raise_error(/unexpected HTTP 503/)
  end
end
