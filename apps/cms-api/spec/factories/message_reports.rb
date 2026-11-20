FactoryBot.define do
  factory :message_report do
    association :message, factory: :message
    association :reported_by, factory: :user
    comment { "The bot response was incorrect." }
  end
end
