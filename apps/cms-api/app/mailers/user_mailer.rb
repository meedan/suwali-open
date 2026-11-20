class UserMailer < Devise::Mailer
  include Devise::Controllers::UrlHelpers
  layout "mailer"
  default template_path: "devise/mailer"

  def confirmation_instructions(record, token, opts = {})
    @token = token
    @resource = record
    @email = record.email
    # Override the confirmation URL to point to frontend
    @confirmation_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/confirm?confirmation_token=#{@token}&email=#{CGI.escape(@email)}"

    devise_mail(record, :confirmation_instructions, opts)
  end

  def reset_password_instructions(record, token, opts = {})
    @token = token
    @resource = record
    @email = record.email
    @reset_password_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/change-password?token=#{CGI.escape(@token)}"

    devise_mail(record, :reset_password_instructions, opts)
  end

  def unlock_instructions(record, token, opts = {})
    @token = token
    @resource = record
    @email = record.email
    @unlock_url = unlock_url(@resource, unlock_token: @token)
    devise_mail(record, :unlock_instructions, opts)
  end

  # Custom action
  def account_exists(record)
    @resource = record
    @email = record.email
    @reset_password_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/forgot-password"

    devise_mail(record, :account_exists, to: @email, subject: I18n.t(:mailer_user_account_exists_subject))
  end
end
