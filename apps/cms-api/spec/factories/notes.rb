FactoryBot.define do
  factory :note do
    notebook { build(:notebook) }
    title { "My note" }
    content { "My text" }
    user { build(:user) }
  end
end
