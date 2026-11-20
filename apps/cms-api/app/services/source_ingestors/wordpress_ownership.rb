require "openssl"
require_relative "wordpress_api"

module SourceIngestors
  # Proves that whoever adds a WordPress source administers the site: they add a code to its
  # tagline, which only administrators (manage_options) can change, and we read it back.
  #
  # The code is derived from the hub and the host rather than stored, so nothing needs saving
  # before the source exists, and a code seen on a public site is useless to any other hub.
  class WordpressOwnership
    CODE_PREFIX = "suwali-"
    RECEIPT_PURPOSE = :wordpress_ownership
    # Long enough to finish the wizard after verifying, short enough that a receipt cannot be hoarded
    RECEIPT_TTL = 1.hour
    CONFIG_KEYS = %w[api_base ownership_verified_at].freeze

    # How Suwali names itself when asking a site's admin to approve an Application Password
    APP_NAME = "Suwali"
    APP_ID = "48517e7b-86ec-44bc-a835-2da780324652"
    AUTHORIZATION_PURPOSE = :wordpress_authorization
    AUTHORIZATION_TTL = 1.hour
    # The frontend page WordPress sends the admin back to, with the new password in its query
    AUTHORIZED_PATH = "/wordpress/authorized"

    def self.code(hub_id:, site_url:)
      host = host_of(site_url)
      return nil if host.blank?

      digest = OpenSSL::HMAC.hexdigest("SHA256", secret, "#{hub_id.to_i}:#{host}")
      # Letters and digits only: WordPress escapes the tagline and typesets dashes and quotes
      "#{CODE_PREFIX}#{digest[0, 12]}"
    end

    def self.settings_url(site_url)
      host = host_of(site_url)
      return nil if host.blank?

      if host.end_with?(".wordpress.com")
        "https://wordpress.com/settings/general/#{host}"
      else
        "#{WordpressApi.normalize_site_url(site_url)}/wp-admin/options-general.php"
      end
    end

    def self.receipt(hub_id:, site_url:, api_base:)
      verifier.generate(
        {"hub_id" => hub_id.to_i, "site_url" => WordpressApi.normalize_site_url(site_url), "api_base" => api_base},
        expires_in: RECEIPT_TTL,
        purpose: RECEIPT_PURPOSE
      )
    end

    # The verified API base, or nil when the receipt is missing, expired, tampered with, or issued
    # for another hub or site
    def self.verified_api_base(receipt, hub_id:, site_url:)
      return nil if receipt.blank?

      data = verifier.verified(receipt.to_s, purpose: RECEIPT_PURPOSE)
      return nil unless data.is_a?(Hash)
      return nil unless data["hub_id"] == hub_id.to_i && data["site_url"] == WordpressApi.normalize_site_url(site_url)

      data["api_base"].presence
    end

    def self.before_validation(source)
      verified = verified_source_config(source)
      source.config = verified if verified
    end

    def self.validate(source)
      source.errors.add(:base, I18n.t(:error_wordpress_ownership_not_verified)) unless verified_source_config(source)
    end

    def self.after_save(source)
      source.ownership_receipt = nil
    end

    def self.verified_config(config, previous:, receipt:, hub_id:)
      config = config.to_h
      api_base = verified_api_base(receipt, hub_id: hub_id, site_url: config["site_url"])
      return config.merge("api_base" => api_base, "ownership_verified_at" => Time.current.iso8601) if api_base
      return nil unless previous && same_site?(previous, config)

      verification = previous.to_h.slice(*CONFIG_KEYS)
      restored = config.reverse_merge(verification)
      (restored.slice(*CONFIG_KEYS) == verification) ? restored : nil
    end

    # The site's own approval page, set to send the admin back to Suwali with a state that ties the
    # approval to this hub and site, as WordPress has no state parameter of its own
    def self.authorize_url(authorization_endpoint, hub_id:, site_url:)
      state = verifier.generate(
        {"hub_id" => hub_id.to_i, "site_url" => WordpressApi.normalize_site_url(site_url)},
        expires_in: AUTHORIZATION_TTL,
        purpose: AUTHORIZATION_PURPOSE
      )
      success_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}#{AUTHORIZED_PATH}?#{{state: state}.to_query}"

      uri = Addressable::URI.parse(authorization_endpoint)
      uri.query_values = (uri.query_values || {}).merge("app_name" => APP_NAME, "app_id" => APP_ID, "success_url" => success_url)
      uri.to_s
    end

    def self.valid_authorization_state?(state, hub_id:, site_url:)
      return false if state.blank?

      data = verifier.verified(state.to_s, purpose: AUTHORIZATION_PURPOSE)
      data.is_a?(Hash) && data["hub_id"] == hub_id.to_i && data["site_url"] == WordpressApi.normalize_site_url(site_url)
    end

    def self.verified_source_config(source)
      verified_config(source.config, previous: (source.config_was if source.persisted?), receipt: source.ownership_receipt, hub_id: source.hub_id)
    end

    def self.same_site?(previous, config)
      WordpressApi.normalize_site_url(previous.to_h["site_url"]) == WordpressApi.normalize_site_url(config["site_url"])
    end

    def self.host_of(site_url)
      Addressable::URI.parse(WordpressApi.normalize_site_url(site_url).to_s).host&.downcase
    rescue Addressable::URI::InvalidURIError
      nil
    end

    def self.secret
      Rails.application.key_generator.generate_key("source_ingestors/wordpress_ownership/code")
    end

    def self.verifier
      Rails.application.message_verifier("source_ingestors/wordpress_ownership/receipt")
    end

    private_class_method :verified_source_config, :same_site?, :host_of, :secret, :verifier
  end
end
