module Api
  class ResendsController < ApplicationController
    respond_to :json

    def create
      email = params.require(:user).permit(:email)[:email]

      if email.present?
        User.send_confirmation_instructions(email: email)
      end

      render json: {success: true}, status: :ok
    end
  end
end
