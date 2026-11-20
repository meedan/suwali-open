FactoryBot.define do
  factory :notebook do
    hub { build(:hub) }
    name { "My Notebook" }
    summary { "Short summary" }
    published { false }
    user { build(:user) }
  end
end
