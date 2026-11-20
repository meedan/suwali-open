FactoryBot.define do
  factory :notebook_item do
    notebook { build(:notebook) }
    item { build(:conversation, hub: notebook.hub) }
  end
end
