require_relative "../unit_spec_helper"
require_relative "../../app/services/telegram_service"

require "webmock/rspec"

RSpec.describe TelegramService do
  let(:bot_token) { "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ" }
  let(:service) { described_class.new(bot_token) }

  before do
    WebMock.disable_net_connect!(allow_localhost: true)
  end

  after do
    WebMock.reset!
  end

  describe "#send_message" do
    let(:chat_id) { "12345" }
    let(:text) { "Hello, World!" }
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/sendMessage" }

    it "sends a POST request to Telegram API with correct parameters" do
      stub_request(:post, endpoint)
        .with(
          body: {
            chat_id: chat_id,
            text: text
          }.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        )
        .to_return(
          status: 200,
          body: {
            ok: true,
            result: {
              message_id: 123,
              date: 1234567890,
              chat: {id: chat_id, type: "private"},
              text: text
            }
          }.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_message(chat_id: chat_id, text: text)

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true
      expect(response.parsed_response["result"]["message_id"]).to eq(123)

      expect(WebMock).to have_requested(:post, endpoint)
        .with(
          body: {
            chat_id: chat_id,
            text: text
          }.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        ).once
    end
  end

  describe "#send_chat_action" do
    let(:chat_id) { "12345" }
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/sendChatAction" }

    it "sends a typing chat action by default" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {ok: true, result: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send_chat_action(chat_id: chat_id)

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true

      expect(WebMock).to have_requested(:post, endpoint)
        .with(
          body: {
            chat_id: chat_id,
            action: "typing"
          }.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        ).once
    end
  end

  describe "#set_webhook" do
    let(:webhook_url) { "https://myapp.com/telegram/webhook" }
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/setWebhook" }

    it "sends a POST request to set webhook with correct parameters" do
      stub_request(:post, endpoint)
        .with(
          body: {
            url: webhook_url
          }.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        )
        .to_return(
          status: 200,
          body: {
            ok: true,
            result: true,
            description: "Webhook was set"
          }.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.set_webhook(url: webhook_url)

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true
      expect(response.parsed_response["result"]).to be true

      expect(WebMock).to have_requested(:post, endpoint)
        .with(
          body: {
            url: webhook_url
          }.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        ).once
    end
  end

  describe "#get_me" do
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/getMe" }

    it "sends a POST request to get information" do
      stub_request(:post, endpoint)
        .with(
          body: {}.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        )
        .to_return(
          status: 200,
          body: {
            ok: true,
            result: {
              id: 123,
              first_name: "Foo",
              username: "foo"
            }
          }.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.get_me

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true

      expect(WebMock).to have_requested(:post, endpoint)
        .with(
          body: {}.to_json,
          headers: {
            "Content-Type" => "application/json"
          }
        ).once
    end
  end

  describe "#post (private method)" do
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/getMe" }

    it "makes HTTP POST request through HTTParty" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {
            ok: true,
            result: {
              id: 123456789,
              is_bot: true,
              first_name: "Test Bot",
              username: "test_bot"
            }
          }.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.send(:post, "/bot#{bot_token}/getMe")

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true
      expect(response.parsed_response["result"]["is_bot"]).to be true

      expect(WebMock).to have_requested(:post, endpoint).once
    end
  end

  describe "#answer_callback_query" do
    let(:callback_query_id) { "callback_query_123" }
    let(:endpoint) { "https://api.telegram.org/bot#{bot_token}/answerCallbackQuery" }

    it "sends answerCallbackQuery request to Telegram API" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {ok: true, result: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      response = service.answer_callback_query(callback_query_id)

      expect(response.code).to eq(200)
      expect(response.parsed_response["ok"]).to be true
      expect(response.parsed_response["result"]).to be true

      expect(WebMock).to have_requested(:post, endpoint).once
    end

    it "sends answerCallbackQuery with optional text parameter" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {ok: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.answer_callback_query(callback_query_id, text: "Processing...")

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req| JSON.parse(req.body)["text"] == "Processing..." }
        .once
    end

    it "sends answerCallbackQuery with optional show_alert parameter" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {ok: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.answer_callback_query(callback_query_id, show_alert: true)

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req| JSON.parse(req.body)["show_alert"] == true }
        .once
    end

    it "omits nil values from request body using compact" do
      stub_request(:post, endpoint)
        .to_return(
          status: 200,
          body: {ok: true}.to_json,
          headers: {"Content-Type" => "application/json"}
        )

      service.answer_callback_query(callback_query_id, text: nil)

      expect(WebMock).to have_requested(:post, endpoint)
        .with { |req| !JSON.parse(req.body).key?("text") }
        .once
    end
  end
end
