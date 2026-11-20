module Api
  class WordpressController < AuthenticatedController
    skip_around_action :set_audit_user

    def detect
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)
      return unless require_admin!(hub)

      site_url = SourceIngestors::WordpressApi.detect_site_url(params[:url], user_agent: Hub.user_agent_for(hub.id))
      render json: {site_url: site_url}, status: :ok
    end
  end
end
