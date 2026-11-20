class WhatsappMessagingIntegration < MessagingIntegration
  # WhatsApp message templates don't accept bare "pt" as a language code
  TEMPLATE_LANGUAGE_CODES = {"pt" => "pt_BR"}.freeze

  def self.topic_notification_template_name(tone)
    "suwali_topic_notification_#{tone}_v3"
  end

  def self.template_language_code(language)
    TEMPLATE_LANGUAGE_CODES.fetch(language, language)
  end

  after_create :ensure_whatsapp_esu_state!
  # Enqueue after commit (not from the controller) so the worker can't run before the
  # Embedded Signup transaction commits and read blank credentials.
  after_commit :enqueue_template_creation, on: :update, if: -> { saved_change_to_active? && active? }

  def platform
    "whatsapp"
  end

  def as_json(options = {})
    extra = if get_credential(:phone_number).blank?
      {
        whatsapp_signup: {
          app_id: ENV["WHATSAPP_APP_ID"],
          configuration_id: ENV["WHATSAPP_CONFIGURATION_ID"],
          redirect_url: "#{ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000")}/api/messaging-integrations/whatsapp-callback",
          state: get_credential(:esu_state),
          api_base: ENV.fetch("WHATSAPP_API_BASE", "https://graph.facebook.com"),
          api_version: ENV.fetch("WHATSAPP_API_VERSION", "v21.0")
        }
      }
    else
      {
        phone_number: get_credential(:phone_number),
        phone_number_status: phone_number_status,
        business_verification_status: business_verification_status,
        template_statuses: template_statuses
      }
    end
    super.merge(extra)
  end

  def phone_number_status
    return nil if get_credential(:phone_number_id).blank? || get_credential(:business_token).blank?

    # Cache so we don't hit WhatsApp Cloud API rate limits
    Rails.cache.fetch("whatsapp_status/#{id}/#{get_credential(:phone_number_id)}", expires_in: 5.minutes) do
      WhatsappService.new.fetch_phone_number_status(get_credential(:phone_number_id), get_credential(:business_token))
      # For easier testing, you can comment the line above and uncomment the line below:
      # {"quality_rating": "GREEN", "status": "CONNECTED", "account_mode": "LIVE"}
    rescue WhatsappService::Error => e
      LogService.log(:error, "WhatsappMessagingIntegration", "Failed to fetch WhatsApp status for integration #{id}: #{e.message}")
      nil
    end
  end

  def business_verification_status
    return nil if get_credential(:waba_id).blank? || get_credential(:business_token).blank?

    # Cache so we don't hit WhatsApp Cloud API rate limits
    Rails.cache.fetch("whatsapp_business_verification_status/#{id}", expires_in: 5.minutes) do
      WhatsappService.new.fetch_business_verification_status(get_credential(:waba_id), get_credential(:business_token))
    rescue WhatsappService::Error => e
      LogService.log(:error, "WhatsappMessagingIntegration", "Failed to fetch WhatsApp business verification status for integration #{id}: #{e.message}")
      nil
    end
  end

  def template_statuses
    return nil if get_credential(:waba_id).blank? || get_credential(:business_token).blank?

    # Cache so we don't hit WhatsApp Cloud API rate limits
    Rails.cache.fetch("whatsapp_template_statuses/#{id}", expires_in: 5.minutes) do
      templates = WhatsappService.new.fetch_message_templates(get_credential(:waba_id), get_credential(:business_token))
      SUPPORTED_LANGUAGES.keys.flat_map do |language|
        code = self.class.template_language_code(language)
        Hub::TONES.map do |tone|
          name = self.class.topic_notification_template_name(tone)
          template = templates.find { |candidate| candidate["name"] == name && candidate["language"] == code }
          {"name" => name, "language" => language, "tone" => tone, "status" => template&.dig("status"), "category" => template&.dig("category")}
        end
      end
    rescue WhatsappService::Error => e
      LogService.log(:error, "WhatsappMessagingIntegration", "Failed to fetch WhatsApp template status for integration #{id}: #{e.message}")
      nil
    end
  end

  private

  def ensure_whatsapp_esu_state!
    return if get_credential(:esu_state).present?

    set_credential(:esu_state, SecureRandom.hex(16))
    save! if changed?
  end

  def enqueue_template_creation
    WhatsappTemplateCreationWorker.perform_async(id)
  end
end
