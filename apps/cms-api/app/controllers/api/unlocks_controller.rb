module Api
  class UnlocksController < Devise::UnlocksController
    respond_to :json

    def show
      self.resource = resource_class.unlock_access_by_token(params[:unlock_token])
      if resource.errors.empty?
        redirect_to "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/login?unlocked=true", allow_other_host: true
      else
        redirect_to "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/login?unlock_failed=true", allow_other_host: true
      end
    end

    def create
      self.resource = resource_class.send_unlock_instructions(resource_params)
      render json: {message: I18n.t(:message_unlock_sent)}, status: :ok
    end

    private

    def resource_params
      params.require(:user).permit(:email)
    end
  end
end
