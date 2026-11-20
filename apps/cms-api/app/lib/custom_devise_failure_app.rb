class CustomDeviseFailureApp < Devise::FailureApp
  # API-only: respond JSON whatever the Accept header says. Routes outside
  # devise_for have no format default, so browsers reach here as */*.
  def respond
    json_error_response
  end

  private

  def json_error_response
    error_code, self.status, error = case warden_message
    when :unconfirmed then ["unconfirmed_email", :unauthorized, i18n_message]
    when :locked then ["login_attempts_rate_limit_exceeded", :too_many_requests, I18n.t(:error_login_attempts_rate_limit_exceeded)]
    else ["invalid_credentials", :unauthorized, i18n_message]
    end

    self.content_type = "application/json"
    self.response_body = {error: error, error_code: error_code}.to_json
  end
end
