require "httparty"

class TelegramService
  include HTTParty

  class Error < StandardError; end

  base_uri "https://api.telegram.org"

  def initialize(bot_token)
    @bot_token = bot_token
  end

  def send_message(chat_id:, text:, **options)
    post("/bot#{@bot_token}/sendMessage", {
      body: {
        chat_id: chat_id,
        text: text,
        **options
      }.to_json,
      headers: {
        "Content-Type" => "application/json"
      }
    })
  end

  # Displays a "typing" indicator for up to 5 seconds or until a message is sent
  def send_chat_action(chat_id:, action: "typing")
    post("/bot#{@bot_token}/sendChatAction", {
      body: {
        chat_id: chat_id,
        action: action
      }.to_json,
      headers: {
        "Content-Type" => "application/json"
      }
    })
  end

  def set_webhook(url:, **options)
    post("/bot#{@bot_token}/setWebhook", {
      body: {
        url: url,
        **options
      }.to_json,
      headers: {
        "Content-Type" => "application/json"
      }
    })
  end

  def get_me
    post("/bot#{@bot_token}/getMe", {
      body: "{}",
      headers: {
        "Content-Type" => "application/json"
      }
    })
  end

  def answer_callback_query(callback_query_id, text: nil, show_alert: false)
    post("/bot#{@bot_token}/answerCallbackQuery", {
      body: {
        callback_query_id: callback_query_id,
        text: text,
        show_alert: show_alert
      }.compact.to_json,
      headers: {
        "Content-Type" => "application/json"
      }
    })
  end

  private

  def post(endpoint, options = {})
    self.class.post(endpoint, options)
  end
end
