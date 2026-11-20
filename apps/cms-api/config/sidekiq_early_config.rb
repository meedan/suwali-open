require "sidekiq" unless defined?(Sidekiq)

puts "Setting up early Sidekiq Redis configuration..."

redis_config = {
  url: ENV.fetch("REDIS_URL", "redis://redis:6379/1")
}

rails_env = ENV["RAILS_ENV"] || "development"

if rails_env == "production"
  redis_config[:ssl] = true
  redis_config[:ssl_params] = {
    verify_mode: 1 # OpenSSL::SSL::VERIFY_PEER
  }
end

Sidekiq.configure_server do |config|
  config.redis = redis_config
end

Sidekiq.configure_client do |config|
  config.redis = redis_config
end
