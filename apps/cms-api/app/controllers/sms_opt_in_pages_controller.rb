# Public, unauthenticated page that carriers review as the opt-in evidence for an SMS campaign
# (see docs/sms-registration-runbook.md). It's served only once an operator has recorded the
# sender's registered brand name, so unregistered hubs never get a public page. English only, by
# design: it's written for US carrier reviewers, so its copy is deliberately not in the locale files.
class SmsOptInPagesController < ActionController::Base
  protect_from_forgery with: :exception
  layout false

  def show
    hub = Hub.find_by(id: params[:hub_id])
    @integration = hub&.messaging_integrations&.find_by(id: params[:id], type: "SmsMessagingIntegration", active: true)
    @brand_name = @integration&.get_setting(:sms_brand_name)
    return head :not_found if @brand_name.blank?

    @hub = hub
  end
end
