FactoryBot.define do
  factory :topic do
    hub { build(:hub) }
    sequence(:name) { |n| "Topic #{n}" }
  end
end
