class TelegramMessagingIntegration < MessagingIntegration
  before_create :generate_telegram_webhook_secret
  after_create :setup_telegram_webhook!

  def platform
    "telegram"
  end

  def webhook_url
    "#{ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000")}/api/webhooks/telegram/#{id}"
  end

  def as_json(options = {})
    super.merge({"bot_name" => get_credential("bot_name"), "bot_username" => get_credential("bot_username")})
  end

  private

  def generate_telegram_webhook_secret
    set_credential(:webhook_secret, SecureRandom.hex(32))
  end

  def setup_telegram_webhook!
    client = TelegramService.new(get_credential(:bot_token))

    response = client.set_webhook(
      url: webhook_url,
      secret_token: get_credential(:webhook_secret),
      allowed_updates: %w[message callback_query message_reaction]
    )
    raise "Failed to set Telegram webhook: #{response.body}" unless response.success?

    response = client.get_me
    raise "Failed to get Telegram bot information: #{response.body}" unless response.success?
    result = response["result"]
    update_column(:credentials, credentials.merge({"bot_name" => result["first_name"], "bot_id" => result["id"], "bot_username" => result["username"]}))
  end
end
