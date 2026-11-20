FactoryBot.define do
  factory :external_resource do
    hub
    title { "Example Resource" }
    scenarios { ["role_description", "error_occurred"] }
    description { "An example external resource" }
  end
end
