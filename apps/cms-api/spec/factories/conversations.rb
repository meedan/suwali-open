FactoryBot.define do
  factory :conversation do
    association :hub
    title { "Chat with Hub" }
    platform { 0 }
    association :participant, factory: :user, strategy: :create

    trait :external do
      platform { 1 }
      association :participant, factory: :external_user, strategy: :create
    end
  end
end
