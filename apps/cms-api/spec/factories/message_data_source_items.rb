FactoryBot.define do
  factory :message_data_source_item do
    association :message, factory: :message, direction: :outgoing

    trait :document do
      association :item, factory: :document
    end

    trait :notebook do
      association :item, factory: :notebook
    end

    trait :contribution do
      association :item, factory: :contribution
    end

    trait :external do
      association :message, factory: [:message, :outgoing_to_external_enduser]
    end

    trait :internal do
      association :message, factory: [:message, :outgoing]
    end

    transient do
      hub { nil }
    end

    after(:create) do |mdsi, evaluator|
      next unless evaluator.hub

      mdsi.message.conversation.update!(hub: evaluator.hub)

      case mdsi.item
      when Document
        mdsi.item.source.update!(hub: evaluator.hub)
      when Notebook
        mdsi.item.update!(hub: evaluator.hub)
      when Contribution
        mdsi.item.update!(hub: evaluator.hub)
      end
    end
  end
end
