module SmsProviders
  # Port that every SMS provider adapter implements. Callers (the webhook + sender services and
  # SmsMessagingIntegration) depend only on this contract, so vendors stay swappable.
  #
  # `deliver` takes normalized keyword args rather than a Message record so adapters stay free of
  # ActiveRecord; the sender service (MessageSenderServices::SmsService) maps a Message onto these,
  # mirroring how MessageSenderServices::WhatsappService maps a Message onto WhatsappService#send_message.
  class Base
    class Error < StandardError
      attr_reader :code

      def initialize(message = nil, code = nil)
        super(message)
        @code = code
      end
    end

    class NoNumbersAvailable < Error; end

    # Send an outbound text message. Returns {external_id:, status:} where status is one of
    # Message's enum symbols (:sent/:delivered/:failed). Raises Error on provider failure.
    #
    # `buttons` (an array of {id:, text:}) opts into rich rendering where the transport supports it
    # (RCS): the recipient sees tappable buttons, while `fallback_text` is delivered verbatim to
    # recipients the transport downgrades to plain SMS. When `buttons` is blank, `body` is sent as-is.
    def deliver(to:, body:, status_callback_url: nil, buttons: nil, fallback_text: nil)
      raise NotImplementedError, "#{self.class} must implement #deliver"
    end

    # Show an ephemeral "typing…" indicator to `to` (E.164). RCS-only and best-effort — the provider
    # decides RCS capability, so this raises Error for non-RCS recipients and the caller (a
    # fire-and-forget worker) logs and moves on.
    def send_typing_indicator(to:)
      raise NotImplementedError, "#{self.class} must implement #send_typing_indicator"
    end

    # Normalize an inbound webhook request into {from:, to:, body:, external_id:, raw:}.
    def parse_inbound(request)
      raise NotImplementedError, "#{self.class} must implement #parse_inbound"
    end

    # Verify the provider's request signature. Returns true/false.
    def verify_signature(request)
      raise NotImplementedError, "#{self.class} must implement #verify_signature"
    end

    # Map a delivery-status callback payload to {external_id:, status:, error: {code:, message:}},
    # or nil if the payload carries no status we track. `error` is omitted when there is none.
    def handle_status_callback(params)
      raise NotImplementedError, "#{self.class} must implement #handle_status_callback"
    end

    # Search for and provision a number for `country` (ISO 3166-1 alpha-2) of the given `type`
    # ("local"/"tollfree"/"mobile"), optionally within `region` (state/province code) or `area_code`
    # (local numbers only) and labelled with `friendly_name`. Raises NoNumbersAvailable when the
    # search comes back empty. Returns the provisioned E.164 number. Manual/
    # operator-driven onboarding for now; registration to actually send is gated separately
    # (see #registration_status).
    def provision_number(country:, type: "tollfree", friendly_name: nil, region: nil, area_code: nil)
      raise NotImplementedError, "#{self.class} must implement #provision_number"
    end

    # Point `phone_number`'s inbound-message webhook at `url` so texts to the number reach our
    # endpoint. Idempotent — safe to call again to re-point it (e.g. a local dev URL vs the deployed
    # one). Returns the configured `url`. Raises Error on provider failure.
    def configure_inbound_webhook(phone_number:, url:)
      raise NotImplementedError, "#{self.class} must implement #configure_inbound_webhook"
    end

    # Poll the provider for the current registration state given the stored references, mapped to
    # our regime-agnostic enum: unregistered → pending → approved → rejected (toll-free), with
    # brand_approved/campaign_pending/suspended additionally used by 10DLC. Kept read-through (like
    # WhatsApp status polling) so the provider stays the source of truth.
    def registration_status(refs)
      raise NotImplementedError, "#{self.class} must implement #registration_status"
    end
  end
end
