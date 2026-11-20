class ExampleMailer < ActionMailer::Base
  def env_backed(user)
    # ok: unsafe-url-ivar-in-mailer
    @frontend_url = ENV.fetch("FRONTEND_URL", "http://localhost:5173")
    mail(to: user.email)
  end

  def env_backed_with_path(user)
    # ok: unsafe-url-ivar-in-mailer
    @review_editors_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/dashboard?hubSettings=team"
    mail(to: user.email)
  end

  def route_helper(resource, token)
    # ok: unsafe-url-ivar-in-mailer
    @unlock_url = unlock_url(resource, unlock_token: token)
    mail(to: resource.email)
  end

  def literal_scheme(user)
    # ok: unsafe-url-ivar-in-mailer
    @docs_url = "https://suwali.io/docs"
    mail(to: user.email)
  end

  def unrelated_ivar(user)
    # ok: unsafe-url-ivar-in-mailer
    @hub_name = user.hub.name
    mail(to: user.email)
  end

  def from_params(user, params)
    # ruleid: unsafe-url-ivar-in-mailer
    @redirect_url = params[:redirect]
    mail(to: user.email)
  end

  def from_model_attribute(user)
    # ruleid: unsafe-url-ivar-in-mailer
    @site_url = user.website
    mail(to: user.email)
  end
end
