FactoryBot.define do
  factory :document do
    source { build(:source) }
    title { "#{Faker::Name.name}.pdf" }
    document_type { "pdf" }
    external_id { Faker::Crypto.md5 }

    trait :with_pdf do
      after(:build) do |document|
        document.file.attach(
          io: File.open(Rails.root.join("spec", "files", "document.pdf")),
          filename: "document.pdf",
          content_type: "application/pdf"
        )
      end
    end
  end
end
