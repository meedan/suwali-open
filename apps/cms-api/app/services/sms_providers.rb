# Registry + factory for SMS provider adapters. The rest of the codebase talks to a provider
# through the SmsProviders::Base port (see #for), never to a vendor SDK directly, so a second
# provider (e.g. Telnyx) can be added later as a drop-in adapter without touching callers.
module SmsProviders
  ADAPTERS = {
    "twilio" => "SmsProviders::Twilio"
  }.freeze

  DEFAULT_PROVIDER = "twilio"

  class UnknownProviderError < StandardError; end

  # Build the adapter configured for the given SmsMessagingIntegration, selecting the concrete
  # provider from its `provider` credential (defaults to Twilio).
  def self.for(integration)
    key = integration.get_credential(:provider).presence || DEFAULT_PROVIDER
    class_name = ADAPTERS[key]
    raise UnknownProviderError, "Unknown SMS provider: #{key}" unless class_name
    class_name.constantize.from_integration(integration)
  end
end
