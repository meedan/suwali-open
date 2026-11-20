FactoryBot.define do
  factory :bulk_conversation_export do
    association :hub
    association :requested_by, factory: :user

    trait :ready do
      status { :ready }
      after(:build) do |export|
        export.file.attach(io: StringIO.new("convo_id\n"), filename: "export.csv", content_type: "text/csv")
      end
    end
  end
end
