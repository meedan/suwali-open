require "rails_helper"

RSpec.describe MessageSenderServices::SignalService, type: :service do
  let!(:hub) { create(:hub) }
  let!(:integration) { create(:signal_messaging_integration, hub: hub, active: true) }
  let(:conversation) { create(:conversation, hub: hub, platform: "signal", participant: create(:external_user, hub: hub, platform: "signal", external_id: "22222222-2222-4222-8222-222222222222")) }
  let(:rpc_url) { "http://signal-cli:8080/api/v1/rpc" }

  attr_reader :sent_params

  def stub_rpc(response)
    stub_request(:post, rpc_url)
      .with { |request| @sent_params = JSON.parse(request.body)["params"] }
      .to_return(status: 200, body: {jsonrpc: "2.0"}.merge(response).to_json, headers: {"Content-Type" => "application/json"})
  end

  it "sends the message as the hub's Signal account and stores its timestamp" do
    message = create(:message, :outgoing, body: "Hello", conversation: conversation)
    stub_rpc(result: {timestamp: 1791467007267})

    described_class.new(message).send_message

    expect(message.reload).to have_attributes(status: "sent", external_id: "#{conversation.id}:1791467007267")
    expect(sent_params).to eq("account" => "+15555550100", "recipient" => ["22222222-2222-4222-8222-222222222222"], "message" => "Hello")
  end

  it "italicizes intermediary messages through a text style" do
    message = create(:message, :outgoing, state: :bot_intermediary_message, body: "Checking sources ✨", conversation: conversation)
    stub_rpc(result: {timestamp: 1})

    described_class.new(message).send_message

    # "✨" is one UTF-16 code unit, so the whole text is 18 units long
    expect(sent_params["textStyle"]).to eq(["0:18:ITALIC"])
  end

  it "lists interactive options as numbered instructions and remembers them for the reply" do
    message = create(:message, :outgoing, body: "Answer", conversation: conversation)
    allow(message).to receive(:interactive_buttons).and_return([{id: "see_sources_#{message.id}", text: "See sources", type: "sources"}])
    stub_rpc(result: {timestamp: 1})

    described_class.new(message).send_message

    expect(sent_params["message"]).to eq("Answer\n\nReply \"1\" to See sources.")
    expect(message.reload.metadata["signal_options"]).to eq("1" => "see_sources_#{message.id}")
  end

  it "marks the message as failed when signal-cli returns an error" do
    message = create(:message, :outgoing, body: "Hello", conversation: conversation)
    stub_rpc(error: {code: -1, message: "Unregistered user"})

    described_class.new(message).send_message

    expect(message.reload.status).to eq("failed")
  end
end
