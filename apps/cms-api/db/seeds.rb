if Rails.env.development?
  rate_limit = ENV["MESSAGE_RATE_LIMIT"]
  ENV["MESSAGE_RATE_LIMIT"] = "0"

  if ENV["DEPLOY_ENV"] == "ci"
    load(Rails.root.join("db/seeds/ci.rb"))
  else
    load(Rails.root.join("db/seeds/development.rb"))
  end

  ENV["MESSAGE_RATE_LIMIT"] = rate_limit
end
