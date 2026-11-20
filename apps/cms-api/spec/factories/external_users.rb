FactoryBot.define do
  factory :external_user do
    hub { build(:hub) }
    platform { 1 }
    external_id { "xyz123" }
    display_name { "External User Name" }
    metadata { {foo: "bar"}.to_json }
    trusted_user { false }
    first_message_at { Time.now.yesterday }
    last_message_at { Time.now.ago(1.hour) }
    messages_count { 10 }
  end
end
