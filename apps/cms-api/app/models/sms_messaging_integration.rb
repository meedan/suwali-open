class SmsMessagingIntegration < MessagingIntegration
  # Maps a number's country + type to its registration regime: US toll-free numbers go through
  # toll-free verification, US local numbers through A2P 10DLC. India DLT / EU sender-ID would be
  # added here without a schema change. A country with a modeled regime is send-gated on its live
  # status; a country without one is flexible and relies on the provider (Twilio) to enforce/reject
  # non-compliant sends (see #approved_for_sending?).
  REGISTRATION_REGIMES = {
    "US" => {"tollfree" => "us_tollfree", "local" => "us_10dlc"}
  }.freeze

  DEFAULT_NUMBER_TYPE = "tollfree"

  # Regime-agnostic lifecycle, mirrored from the provider's live state (see #registration_status).
  # Toll-free uses unregistered → pending → approved/rejected; 10DLC adds brand_approved/campaign_pending.
  REGISTRATION_STATUSES = %w[unregistered pending brand_approved campaign_pending approved rejected suspended].freeze

  # Countries offered for SMS provisioning, surfaced via /about so the frontend list is backend-driven.
  # Hardcoded for now; can grow without any frontend change. Names are in the same language as the country.
  SUPPORTED_COUNTRIES = {
    "US" => "United States"
  }.freeze

  # Onboarding sets this (the country picked in the UI) so provisioning runs as a model callback,
  # keeping the controller free of SMS-specific steps. Blank for factory/other creates, which skip
  # provisioning. Provisioning runs before_create (it doesn't need the record's id), so a failure
  # raises before the INSERT and no numberless integration is ever persisted.
  attr_accessor :provisioning_country

  # Optional US state preference for local-number provisioning (two-letter code, e.g. "CA");
  # toll-free numbers are nationwide, so it only applies to the local type.
  attr_accessor :provisioning_state

  # Optional three-digit area code for local-number provisioning (e.g. "718"), an alternative to
  # the state preference when a hub needs a specific part of a state.
  attr_accessor :provisioning_area_code

  # Number type picked at onboarding (tollfree/local), which selects the registration regime.
  attr_writer :provisioning_number_type

  def provisioning_number_type
    @provisioning_number_type.presence || DEFAULT_NUMBER_TYPE
  end

  def self.number_types_for(country)
    REGISTRATION_REGIMES.fetch(country, {}).keys.presence || [DEFAULT_NUMBER_TYPE]
  end

  # SMS is gated behind a per-hub plan limit (custom_limits["sms"]) set by super-admins. Enforced on
  # create so a number is never provisioned for a hub that isn't entitled to SMS (runs before the
  # before_create provisioning callback).
  validate :check_sms_plan_limit, on: :create

  # Restrict provisioning to supported countries so a request can't provision a number in an arbitrary
  # country on our Twilio account. Runs before the provisioning callback (validation precedes create).
  validate :check_provisioning_country, on: :create
  validate :check_provisioning_number_type, on: :create
  validate :check_provisioning_area_code, on: :create

  before_create :provision_number!, if: -> { provisioning_country.present? }
  after_create :wire_webhook_on_create, if: -> { provisioning_country.present? }

  def platform
    "sms"
  end

  # RCS rides on top of this SMS integration when a per-hub RCS agent has been provisioned onto the
  # record. `rcs_agent_id` is the RBM agent id used in `rcs:` addressing (e.g. "acme_a1b2c3d4_agent"),
  # NOT the Twilio "XE…" sender-resource SID. When set, outbound messages with buttons are sent as RCS
  # cards (with an SMS text fallback) and typing indicators are attempted; when blank, the integration
  # behaves as plain SMS. See SmsProviders::Twilio.
  def rcs_enabled?
    get_setting(:rcs_agent_id).present?
  end

  def webhook_url
    "#{external_base_url}/api/webhooks/sms/#{id}"
  end

  # Provision a dedicated number for `country` and persist it along with the registration regime.
  # The number can send only once its registration clears (see #approved_for_sending?). Runs as the
  # after_create hook (country from #provisioning_country) and is also callable directly.
  def provision_number!(country: provisioning_country, type: provisioning_number_type, state: provisioning_state, area_code: provisioning_area_code)
    # Friendly name (shown in the Twilio Console) is the hub name, so numbers are identifiable there;
    # capped at Twilio's 64-char FriendlyName limit.
    number = SmsProviders.for(self).provision_number(
      country: country, type: type, friendly_name: hub.name.first(64),
      region: (state.presence if type.to_s == "local"),
      area_code: (area_code.presence if type.to_s == "local")
    )
    set_credential(:phone_number, number)
    set_setting(:registration, registration.merge(
      "registration_type" => REGISTRATION_REGIMES.dig(country, type.to_s),
      "country" => country,
      "number_type" => type.to_s
    ))
    # Inside before_create the INSERT persists these; called directly on a saved record, persist now.
    save! unless new_record?
    number
  rescue SmsProviders::Base::Error => e
    # Surface provisioning failures as a validation error so the controller's generic RecordInvalid
    # handling renders them (no SMS-specific rescue needed there). before_create raises before the
    # INSERT, so nothing is persisted.
    LogService.log(:error, "SmsMessagingIntegration", "SMS number provisioning failed: #{e.message}")
    unavailable_area_code = e.is_a?(SmsProviders::Base::NoNumbersAvailable) && area_code.present? && type.to_s == "local"
    errors.add(:base, unavailable_area_code ? I18n.t(:error_sms_area_code_unavailable, area_code: area_code) : I18n.t(:error_sms_provisioning_failed))
    raise ActiveRecord::RecordInvalid, self
  end

  # Point this integration's provisioned number at its inbound webhook (#webhook_url). Runs after_create
  # (needs the persisted id for #webhook_url) and is also callable directly to re-point the number —
  # e.g. from a local dev URL while developing to the deployed URL after release. Idempotent; raises on
  # provider failure so the console/tests surface it.
  def configure_webhook!
    SmsProviders.for(self).configure_inbound_webhook(phone_number: get_credential(:phone_number), url: webhook_url)
  end

  # Stored registration references (registration_type, country, and regime-specific SIDs:
  # tollfree_verification_sid for us_tollfree; brand_sid/campaign_sid/messaging_service_sid for
  # us_10dlc). Recorded manually/hand-held for now; the live status is polled.
  def registration
    get_setting(:registration).to_h.with_indifferent_access
  end

  def set_registration_reference(key, value)
    set_setting(:registration, registration.merge(key.to_s => value).to_h)
  end

  # Live registration state polled from the provider and cached, mirroring how WhatsApp status is
  # fetched. nil when the country has no modeled regime (nothing to register) or on provider error.
  def registration_status
    return nil if registration[:registration_type].blank?

    # skip_nil so a failed poll isn't cached as "unknown" for 5 minutes, blocking sends meanwhile
    Rails.cache.fetch("sms_registration_status/#{id}", expires_in: 5.minutes, skip_nil: true) do
      SmsProviders.for(self).registration_status(registration)
    rescue SmsProviders::Base::Error => e
      LogService.log(:error, "SmsMessagingIntegration", "Failed to fetch SMS registration status for integration #{id}: #{e.message}")
      nil
    end
  end

  # Hybrid gate: countries with a modeled regime (US 10DLC) may send only once their registration is
  # approved; countries without one are flexible and left to the provider to enforce.
  def approved_for_sending?
    return true if registration[:registration_type].blank?
    registration_status == "approved"
  end

  # Public opt-in page for campaign registration, only exists once the sender's brand name is recorded
  def opt_in_url
    return nil if get_setting(:sms_brand_name).blank?
    "#{external_base_url}/sms-opt-in/#{hub_id}/#{id}"
  end

  def as_json(options = {})
    super.merge({
      "provider" => get_credential(:provider),
      "phone_number" => get_credential(:phone_number),
      "country" => registration[:country],
      "number_type" => registration[:number_type],
      "registration_type" => registration[:registration_type],
      "registration_status" => registration_status,
      "rcs_enabled" => rcs_enabled?,
      "opt_in_url" => opt_in_url
    })
  end

  private

  def check_sms_plan_limit
    return if hub.nil? || hub.can_use_sms?
    errors.add(:base, hub.sms_restriction_error)
  end

  def check_provisioning_country
    return if provisioning_country.blank? || SUPPORTED_COUNTRIES.key?(provisioning_country)
    errors.add(:base, I18n.t(:error_sms_unsupported_country))
  end

  def check_provisioning_number_type
    return if provisioning_country.blank?
    return if self.class.number_types_for(provisioning_country).include?(provisioning_number_type)
    errors.add(:base, I18n.t(:error_sms_unsupported_number_type))
  end

  def check_provisioning_area_code
    return if provisioning_area_code.blank?
    return errors.add(:base, I18n.t(:error_sms_state_and_area_code)) if provisioning_state.present?
    errors.add(:base, I18n.t(:error_sms_invalid_area_code)) unless provisioning_area_code.to_s.match?(/\A\d{3}\z/)
  end

  # after_create hook: the number is already provisioned and the record persisted, so a webhook blip
  # must not roll it back (that would orphan a paid number on Twilio). Log and leave it re-runnable via
  # #configure_webhook! — the number simply won't receive inbound until it's rewired.
  def wire_webhook_on_create
    configure_webhook!
  rescue SmsProviders::Base::Error => e
    LogService.log(:error, "SmsMessagingIntegration", "SMS webhook configuration failed: #{e.message}")
  end

  def external_base_url
    ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000")
  end
end
