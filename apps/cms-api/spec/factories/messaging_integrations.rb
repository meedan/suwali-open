FactoryBot.define do
  factory :messaging_integration, class: "InternalMessagingIntegration" do
    hub { build(:hub) }
    active { false }
  end

  factory :internal_messaging_integration, parent: :messaging_integration, class: "InternalMessagingIntegration" do
  end

  factory :telegram_messaging_integration, parent: :messaging_integration, class: "TelegramMessagingIntegration" do
  end

  factory :whatsapp_messaging_integration, parent: :messaging_integration, class: "WhatsappMessagingIntegration" do
  end

  factory :signal_messaging_integration, parent: :messaging_integration, class: "SignalMessagingIntegration" do
    credentials { {"phone_number" => "+15555550100"} }
  end

  factory :sms_messaging_integration, parent: :messaging_integration, class: "SmsMessagingIntegration" do
    # SMS is gated behind the per-hub custom_limits["sms"] plan limit, so the hub must have it enabled.
    hub { build(:hub, custom_limits: {"sms" => true}) }
  end
end
