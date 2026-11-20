FactoryBot.define do
  factory :contribution do
    content { "My contribution" }
    message { create(:message, :incoming) }
    hub { create(:hub) }
  end
end
