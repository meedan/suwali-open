require_relative "../unit_spec_helper"
require_relative "../../app/services/signal_service"

require "webmock/rspec"

RSpec.describe SignalService do
  let(:service) { described_class.new("+15555550100") }
  let(:endpoint) { "http://signal-cli:8080/api/v1/rpc" }
  let(:recipient) { "22222222-2222-4222-8222-222222222222" }

  before do
    WebMock.disable_net_connect!(allow_localhost: true)
  end

  after do
    WebMock.reset!
  end

  def stub_rpc(response, status: 200)
    stub_request(:post, endpoint)
      .to_return(status: status, body: {jsonrpc: "2.0"}.merge(response).to_json, headers: {"Content-Type" => "application/json"})
  end

  def requested_rpc(method, params)
    a_request(:post, endpoint).with do |request|
      body = JSON.parse(request.body)
      body["jsonrpc"] == "2.0" && body["method"] == method && body["params"] == params
    end
  end

  describe "#send_message" do
    it "sends the message as the account and returns its timestamp" do
      stub_rpc({result: {timestamp: 1791467007267}})

      expect(service.send_message(recipient: recipient, message: "Hello")).to eq(1791467007267)
      expect(requested_rpc("send", "account" => "+15555550100", "recipient" => [recipient], "message" => "Hello")).to have_been_made
    end

    it "passes text styles when given" do
      stub_rpc({result: {timestamp: 1}})

      service.send_message(recipient: recipient, message: "Hello", text_style: ["0:5:ITALIC"])

      expect(requested_rpc("send", "account" => "+15555550100", "recipient" => [recipient], "message" => "Hello", "textStyle" => ["0:5:ITALIC"])).to have_been_made
    end

    it "raises when signal-cli returns a JSON-RPC error" do
      stub_rpc({error: {code: -1, message: "Unregistered user"}})

      expect { service.send_message(recipient: recipient, message: "Hello") }.to raise_error(SignalService::Error, /Unregistered user/)
    end

    it "raises a SignalService::Error when signal-cli can't be reached" do
      stub_request(:post, endpoint).to_raise(Errno::ECONNREFUSED)

      expect { service.send_message(recipient: recipient, message: "Hello") }.to raise_error(SignalService::Error, /unreachable: Errno::ECONNREFUSED/)
    end

    it "waits longer than other calls for signal-cli to send" do
      stub_rpc({result: {timestamp: 1}})
      expect(described_class).to receive(:post).with("/api/v1/rpc", hash_including(timeout: described_class::SEND_TIMEOUT)).and_call_original

      service.send_message(recipient: recipient, message: "Hello")
    end

    it "raises a SignalService::Error when signal-cli times out" do
      stub_request(:post, endpoint).to_timeout

      expect { service.send_message(recipient: recipient, message: "Hello") }.to raise_error(SignalService::Error, /unreachable/)
    end

    it "raises when signal-cli responds with an HTTP error" do
      stub_rpc({}, status: 500)

      expect { service.send_message(recipient: recipient, message: "Hello") }.to raise_error(SignalService::Error, /HTTP 500/)
    end
  end

  describe "linking" do
    let(:service) { described_class.new }
    let(:link_uri) { "sgnl://linkdevice?uuid=abc&pub_key=def" }

    it "starts linking without an account and returns the link to show as a QR code" do
      stub_rpc({result: {deviceLinkUri: link_uri}})

      expect(service.start_link).to eq(link_uri)
      expect(requested_rpc("startLink", {})).to have_been_made
    end

    it "finishes linking and returns the linked number" do
      stub_rpc({result: {number: "+15555550100", aci: "11111111-1111-4111-8111-111111111111"}})

      expect(service.finish_link(link_uri, "Suwali")).to eq("+15555550100")
      expect(requested_rpc("finishLink", "deviceLinkUri" => link_uri, "deviceName" => "Suwali")).to have_been_made
    end
  end

  describe "#list_accounts" do
    it "returns the numbers of the linked accounts" do
      stub_rpc({result: [{number: "+15555550100", aci: "11111111-1111-4111-8111-111111111111"}]})

      expect(described_class.new.list_accounts).to eq(["+15555550100"])
    end
  end

  describe "#find_account_id" do
    it "returns the account id of the user with that phone number" do
      stub_rpc({result: [{recipient: "+15555550199", number: "+15555550199", uuid: recipient, isRegistered: true}]})

      expect(service.find_account_id("+15555550199")).to eq(recipient)
      expect(requested_rpc("getUserStatus", "account" => "+15555550100", "recipient" => ["+15555550199"])).to have_been_made
    end

    it "returns nil when the number isn't on Signal" do
      stub_rpc({result: [{recipient: "+15555550199", number: "+15555550199", uuid: nil, isRegistered: false}]})

      expect(service.find_account_id("+15555550199")).to be_nil
    end
  end

  describe "#delete_local_account_data" do
    it "deletes the account's data even if it's still registered" do
      stub_rpc({result: {}})

      service.delete_local_account_data

      expect(requested_rpc("deleteLocalAccountData", "account" => "+15555550100", "ignoreRegistered" => true)).to have_been_made
    end
  end

  describe "#send_typing" do
    it "sends a typing indicator to the recipient" do
      stub_rpc({result: {}})

      service.send_typing(recipient: recipient)

      expect(requested_rpc("sendTyping", "account" => "+15555550100", "recipient" => [recipient])).to have_been_made
    end
  end
end
