FactoryBot.define do
  factory :user do
    name { "Test User" }
    email { Faker::Internet.email }
    password { "password123@" }
    password_confirmation { "password123@" }
    confirmed_at { Time.current }
    confirmation_token { nil }
    confirmation_sent_at { nil }
    # Mid-session, so specs don't pay for an activity write on every request.
    last_active_at { Time.current }

    trait :with_profile_picture do
      after(:build) do |user|
        user.profile_picture.attach(
          io: StringIO.new(Base64.decode64("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")),
          filename: "avatar.png",
          content_type: "image/png"
        )
      end
    end
  end
end
