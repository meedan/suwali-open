require_relative "wordpress_api"
require_relative "wordpress_ownership"

module SourceIngestors
  # Checks that a hub's admin administers a WordPress site, through its tagline or an Application
  # Password. When either proves it, returns a short-lived receipt that Source accepts as proof, so
  # creating the source never has to call the site.
  class WordpressOwnershipVerifier
    class InvalidSiteUrlError < StandardError; end

    class InvalidAuthorizationError < StandardError; end

    def initialize(hub_id:, site_url:)
      @hub_id = hub_id
      @site_url = site_url
      @code = WordpressOwnership.code(hub_id: hub_id, site_url: site_url)
      raise InvalidSiteUrlError if @code.nil?
    end

    # The code to add to the site's tagline, and where the site's admin changes it. When the site
    # supports Application Passwords, also where its admin can approve Suwali instead.
    def instructions
      authorization_endpoint = ingestor.application_passwords_authorization_url
      authorize_url = if authorization_endpoint
        WordpressOwnership.authorize_url(authorization_endpoint, hub_id: @hub_id, site_url: @site_url)
      end

      {code: @code, settings_url: WordpressOwnership.settings_url(@site_url), authorize_url: authorize_url}
    end

    def verify_tagline
      return {verified: false} unless ingestor.tagline_includes?(@code)

      {verified: true, receipt: receipt}
    end

    def verify_application_password(state:, user_login:, password:)
      raise InvalidAuthorizationError unless WordpressOwnership.valid_authorization_state?(state, hub_id: @hub_id, site_url: @site_url)

      check = ingestor.check_administrator(user_login, password)
      if check.status == :verified
        {verified: true, receipt: receipt, password_revoked: check.password_revoked}
      else
        {verified: false, reason: check.status, password_revoked: check.password_revoked}
      end
    end

    private

    def receipt
      WordpressOwnership.receipt(hub_id: @hub_id, site_url: @site_url, api_base: ingestor.api_base)
    end

    def ingestor
      @ingestor ||= WordpressApi.new({"site_url" => @site_url, "user_agent" => Hub.user_agent_for(@hub_id)}.with_indifferent_access)
    end
  end
end
