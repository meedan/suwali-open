class SignalInboundWorker
  include Sidekiq::Worker
  # The arguments carry message contents, so a job that keeps failing is dropped rather than kept in the dead set
  sidekiq_options queue: :messaging, retry: 3, dead: false

  def perform(event_json)
    WebhookServices::SignalService.new(JSON.parse(event_json)).process
  end
end
