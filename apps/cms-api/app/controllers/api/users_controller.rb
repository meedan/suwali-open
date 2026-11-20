module Api
  class UsersController < ApplicationController
    before_action :authenticate_user!

    def me
      render json: {
        user: current_user.as_json(include_hubs: true, include_activity: true)
      }, status: :ok
    end

    def update
      if current_user.update(user_params)
        render json: current_user, status: :ok
      else
        render json: {errors: current_user.errors.full_messages}, status: :unprocessable_content
      end
    end

    def update_password
      # update_with_password silently drops a blank password and reports success,
      # so reject it here rather than returning a 200 that changed nothing.
      if password_params[:password].blank?
        current_user.errors.add(:password, :blank)
        return render json: {errors: current_user.errors.full_messages}, status: :unprocessable_content
      end

      # update_with_password checks valid_password? directly, bypassing the
      # sign-in lockout bookkeeping in Devise::Models::Lockable#valid_for_authentication?.
      # Run the same check through that method first, so repeated wrong
      # current_password guesses lock the account exactly like failed logins do.
      # (An already-locked account never reaches this action at all: Devise's
      # global activatable Warden hook rejects it in authenticate_user! first.)
      authenticated = current_user.valid_for_authentication? { current_user.valid_password?(password_params[:current_password]) }
      throw(:warden, scope: :user, message: :locked) if current_user.access_locked?

      unless authenticated
        current_user.errors.add(:current_password, :invalid)
        return render json: {errors: current_user.errors.full_messages}, status: :unprocessable_content
      end

      if current_user.update_with_password(password_params)
        current_user.reset_failed_attempts!
        dispatch_fresh_jwt
        render json: current_user, status: :ok
      else
        render json: {errors: current_user.errors.full_messages}, status: :unprocessable_content
      end
    end

    private

    def user_params
      params.require(:user).permit(:name, :profile_picture)
    end

    def password_params
      params.require(:user).permit(:current_password, :password, :password_confirmation)
    end

    # Changing the password revokes any JWT issued before password_changed_at
    # (see JwtDenylist#jwt_revoked?), which would otherwise log the current
    # session out too. Issue a fresh token the same way devise-jwt does for
    # /api/login, so the current session stays signed in.
    #
    # password_changed_at has sub-second precision, but a JWT's iat claim is
    # whole seconds only. A token minted immediately after, in the same wall
    # second, would floor to an iat that still compares as "before" the
    # precise password_changed_at and get self-revoked on its first use.
    # Force iat safely past it rather than trusting Time.now to land later.
    def dispatch_fresh_jwt
      aud = Warden::JWTAuth::EnvHelper.aud_header(request.env)
      payload = Warden::JWTAuth::PayloadUserHelper.payload_for_user(current_user, :user).merge(
        "aud" => aud,
        "iat" => current_user.password_changed_at.to_i + 1
      )
      token = Warden::JWTAuth::TokenEncoder.new.call(payload)
      response.set_header("Authorization", "Bearer #{token}")
    end
  end
end
