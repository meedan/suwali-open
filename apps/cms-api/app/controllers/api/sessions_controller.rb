module Api
  class SessionsController < Devise::SessionsController
    respond_to :json

    private

    def respond_with(resource, _opts = {})
      resource.track_login! if resource.persisted?
      render json: {
        message: I18n.t(:message_logged_in_successfully),
        user: resource.as_json(include_hubs: true, include_activity: true)
      }, status: :ok
    end

    def respond_to_on_destroy(non_navigational_status: :no_content)
      render json: {message: I18n.t(:message_logged_out_successfully)}, status: :ok
    end
  end
end
