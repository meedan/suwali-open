FactoryBot.define do
  factory :message do
    association :conversation
    body { "This is a message in a conversation." }

    trait :outgoing do
      direction { 1 }
    end

    trait :incoming do
      direction { 0 }
    end

    trait :outgoing_to_external_enduser do
      outgoing
      association :conversation, factory: [:conversation, :external]
    end
  end
end
