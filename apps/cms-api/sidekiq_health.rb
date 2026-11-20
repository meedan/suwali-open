require "sinatra"
require "sidekiq/api"
require "json"

set :bind, "0.0.0.0"
set :port, 9393
set :logging, false

get "/health" do
  content_type :json

  stats = Sidekiq::Stats.new
  # We can add more complex logic for "healthy" later - e.g., based on throughput, queue size, etc.
  healthy = stats.processes_size > 0

  status healthy ? 200 : 503

  {
    status: healthy ? "ok" : "unhealthy",
    sidekiq_processes: stats.processes_size,
    enqueued_jobs: stats.enqueued,
    retries: stats.retry_size,
    dead_jobs: stats.dead_size,
    timestamp: Time.now.utc.iso8601
  }.to_json
end
