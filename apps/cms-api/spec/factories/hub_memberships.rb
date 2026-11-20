FactoryBot.define do
  factory :hub_membership do
    user { build(:user) }
    hub { build(:hub) }
    role { "editor" }
    approved { true }

    trait :unapproved do
      approved { false }
    end
  end
end
