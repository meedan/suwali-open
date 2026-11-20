module Api
  class WordpressOwnershipController < AuthenticatedController
    # No DB writes; slow external call would hit Postgres' idle-in-transaction timeout.
    skip_around_action :set_audit_user
    before_action :set_verifier

    rescue_from SourceIngestors::WordpressOwnershipVerifier::InvalidSiteUrlError do
      render json: {error: I18n.t(:error_wordpress_site_url_invalid)}, status: :unprocessable_content
    end

    def code
      render json: @verifier.instructions, status: :ok
    end

    def verify
      result = if params[:authorization].present?
        authorization = params.require(:authorization).permit(:state, :user_login, :password)
        @verifier.verify_application_password(
          state: authorization[:state], user_login: authorization[:user_login], password: authorization[:password]
        )
      else
        @verifier.verify_tagline
      end
      render json: result, status: :ok
    rescue SourceIngestors::WordpressOwnershipVerifier::InvalidAuthorizationError
      render json: {error: I18n.t(:error_wordpress_authorization_invalid)}, status: :unprocessable_content
    rescue SourceIngestors::HttpClient::ResponseTooLargeError, SourceIngestors::HttpClient::InvalidUrlError,
      SourceIngestors::HttpClient::FetchFailedError => e
      LogService.log(:warn, "WordpressOwnershipController", "verify failed: #{e.message}")
      render json: {error: e.message}, status: :unprocessable_content
    rescue SourceIngestors::WordpressApi::SiteCheckFailedError => e
      LogService.log(:error, "WordpressOwnershipController", "verify failed, site check: #{e.message}")
      render json: {error: I18n.t(:error_wordpress_ownership_check_failed)}, status: :unprocessable_content
    rescue => e
      LogService.log(:error, "WordpressOwnershipController", "verify failed: #{e.class}: #{e.message}")
      render json: {error: I18n.t(:error_wordpress_ownership_check_failed)}, status: :unprocessable_content
    end

    private

    def set_verifier
      source_params = params.require(:source).permit(:hub_id, config: [:site_url])
      hub = Hub.find(source_params[:hub_id].to_i)
      return unless require_member!(hub)
      return unless require_admin!(hub)

      @verifier = SourceIngestors::WordpressOwnershipVerifier.new(hub_id: hub.id, site_url: source_params.dig(:config, :site_url))
    end
  end
end
