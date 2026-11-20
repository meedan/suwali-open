module Api
  class ConfirmationsController < Devise::ConfirmationsController
    respond_to :json

    def show
      # HEAD requests should not trigger any confirmation logic
      # They're often sent by email clients/browsers for security scanning
      if request.head?
        head :ok
        return
      end

      # Override GET requests to prevent email scanners from confirming accounts
      # Redirect to frontend without confirming
      # Host is FRONTEND_URL; the escaped token cannot break out of the query string.
      # nosemgrep: ruby.rails.security.audit.xss.avoid-redirect.avoid-redirect
      redirect_to "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/confirm?confirmation_token=#{CGI.escape(params[:confirmation_token].to_s)}", allow_other_host: true
    end

    def create
      self.resource = resource_class.confirm_by_token(params[:confirmation_token])

      if resource.errors.empty?
        # Return the user's email so the frontend can pre-fill the sign-in form,
        # allowing the user to confirm and log in without retyping their email.
        render json: {success: true, email: resource.email}, status: :ok
      else
        render json: {success: false, errors: resource.errors.full_messages}, status: :unprocessable_content
      end
    end
  end
end
