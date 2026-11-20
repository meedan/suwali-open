RSpec.configure do |config|
  # Reset Rack::Attack counters before every test so throttle state never
  # leaks between examples. Without this, tests that make login requests
  # (directly or via auth setup) can exhaust the logins/ip throttle and
  # cause unrelated specs to receive 429 responses.
  config.before(:each) do
    Rack::Attack.cache.store.clear
  end
end
