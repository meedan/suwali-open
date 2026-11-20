FactoryBot.define do
  factory :deleted_topic_item do
    transient do
      hub { build(:hub) }
    end

    topic { build(:topic, hub: hub) }
    item { build(:notebook, hub: hub) }
  end
end
