FactoryBot.define do
  factory :topic_subscription do
    transient do
      hub { build(:hub) }
    end

    topic { build(:topic, hub: hub) }
    external_user { build(:external_user, hub: hub) }
  end
end
