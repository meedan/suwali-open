FactoryBot.define do
  factory :hub do
    name { "Meedan Hub" }
    # invite_code and contribution_code are generated automatically by the model's before_validation callbacks
    plan { :enterprise }
    # The suite runs with PRELOADED_PDF_DOCUMENT_URL set, and creating a hub creates its preloaded
    # source right away. Specs that exercise it pass skip_data_preload: false.
    skip_data_preload { true }
    association :organization
  end
end
