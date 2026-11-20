module Api
  class RegistrationsController < Devise::RegistrationsController
    respond_to :json

    def create
      build_resource(sign_up_params.except(:invite_code))
      invite_code = sign_up_params[:invite_code].to_s

      hub = Hub.find_by(invite_code: invite_code) unless invite_code.blank?

      # Email and invite code are hashed (salted) so they can be correlated
      # across log lines without exposing PII or reversible invite codes.
      salt = Rails.application.secret_key_base
      email = resource.email.to_s.downcase.strip
      email_hash = Digest::SHA256.hexdigest("#{salt}:#{email}")
      code_hash = Digest::SHA256.hexdigest("#{salt}:#{invite_code}") if invite_code.present?

      LogService.log(:info, "RegistrationsController", "Registration attempt: hub_id=#{hub&.id}, email_hash=#{email_hash}")

      if invite_code.present? && hub.nil?
        context = {
          ip: request.ip,
          user_agent: request.user_agent,
          request_id: request.request_id,
          controller: "RegistrationsController",
          action: "create",
          endpoint: request.path,
          email_hash: email_hash,
          invite_code_hash: code_hash
        }

        LogService.log(:warn, "RegistrationsController", "Invalid invite code attempt: #{context.to_json}")

        # Report to Sentry (warning level, not an exception)
        Sentry.capture_message("Invalid invite code attempt", level: :warning, extra: context) if defined?(Sentry)

        resource.errors.add(:base, I18n.t(:message_user_registration_invalid_invite_code))
        return render json: {errors: resource.errors.full_messages}, status: :unprocessable_content
      end

      # Prevent user enumeration: if the email is already taken, send a notification email instead of revealing the account exists.
      existing_user = User.find_by(email: email)
      if existing_user
        LogService.log(:info, "RegistrationsController", "Registration attempted for existing email: email_hash=#{email_hash}")
        UserMailer.account_exists(existing_user).deliver_later
        return render json: {message: I18n.t(:message_registration_check_email)}, status: :ok
      end

      begin
        ActiveRecord::Base.transaction do
          resource.save!
          LogService.log(:info, "RegistrationsController", "User created: user_id=#{resource.id}, email_hash=#{email_hash}")

          if hub.present?
            HubMembership.create!(user: resource, hub: hub)
            LogService.log(:info, "RegistrationsController", "HubMembership created: user_id=#{resource.id}, hub_id=#{hub.id}, email_hash=#{email_hash}")
          end
        end

        LogService.log(:info, "RegistrationsController", "Registration successful: user_id=#{resource.id}, email_hash=#{email_hash}")
        render json: {message: I18n.t(:message_registration_check_email)}, status: :ok
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotSaved => e
        errors = e.record ? e.record.errors.full_messages : [e.message]
        LogService.log(:error, "RegistrationsController", "Registration failed: errors=#{errors}, email_hash=#{email_hash}")
        Sentry.capture_exception(e) if defined?(Sentry)
        clean_up_passwords resource
        render json: {errors: errors}, status: :unprocessable_content
      end
    end

    private

    def sign_up_params
      params.require(:user).permit(
        :email,
        :password,
        :password_confirmation,
        :invite_code
      )
    end
  end
end
