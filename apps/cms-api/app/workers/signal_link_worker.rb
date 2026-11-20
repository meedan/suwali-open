class SignalLinkWorker
  include Sidekiq::Worker
  # A QR code can only be scanned once, so a retry couldn't succeed; the admin starts over instead
  sidekiq_options queue: :default, retry: 0

  def perform(integration_id)
    SignalMessagingIntegration.find_by(id: integration_id)&.complete_link!
  end
end
