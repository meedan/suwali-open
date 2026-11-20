module Api
  class PasswordsController < Devise::PasswordsController
    respond_to :json

    def create
      self.resource = resource_class.send_reset_password_instructions(resource_params)
      yield resource if block_given?

      # Always return success for security (don't reveal if email exists)
      # This is the standard security practice for password reset
      render json: {
        message: I18n.t(:message_password_reset_sent)
      }, status: :ok
    end

    def update
      self.resource = resource_class.reset_password_by_token(resource_params)
      yield resource if block_given?

      if resource.errors.empty?
        resource.unlock_access! if unlockable?(resource)

        render json: {
          message: I18n.t(:message_password_reset_successfully)
        }, status: :ok
      else
        set_minimum_password_length
        render json: {
          errors: resource.errors.full_messages
        }, status: :unprocessable_content
      end
    end

    private

    def resource_params
      params.require(:user).permit(:email, :password, :password_confirmation, :reset_password_token)
    end
  end
end
