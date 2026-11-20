class HubMailer < ActionMailer::Base
  layout "mailer"
  default template_path: "hub/mailer"
  default from: ENV.fetch("EMAIL_FROM", "no-reply@suwali.io")

  def join_request(hub, user)
    @hub_name = hub.name
    @user_email = user.email
    @review_editors_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/dashboard?hubSettings=team"
    admin_emails = hub.admins.map(&:email).compact
    mail(to: admin_emails, subject: t("mailer_hub_join_request_subject", hub_name: @hub_name))
  end

  def join_with_invite_code(hub, user)
    @hub_name = hub.name
    @user_email = user.email
    @review_editors_url = "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/dashboard?hubSettings=team"
    admin_emails = hub.admins.map(&:email).compact
    mail(to: admin_emails, subject: t("mailer_hub_join_with_invite_code_subject", hub_name: @hub_name))
  end

  def welcome_new_member(hub, user)
    @hub_name = hub.name
    @frontend_url = ENV.fetch("FRONTEND_URL", "http://localhost:5173")
    mail(to: user.email, subject: t("mailer_hub_welcome_new_member_subject", hub_name: @hub_name))
  end

  def trial_welcome(user)
    set_trial_email_vars(user, "mailer_hub_trial_welcome_body")
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_welcome_subject"))
  end

  def trial_halfway(user)
    set_trial_email_vars(user, "mailer_hub_trial_halfway_body",
      personalization_link: linkify("https://www.suwali.io/resources/#set-up-personalization"))
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_halfway_subject"))
  end

  def trial_one_week_left(user)
    set_trial_email_vars(user, "mailer_hub_trial_one_week_left_body",
      whatsapp_link: linkify("https://www.suwali.io/resources/#connect-whatsapp"))
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_one_week_left_subject"))
  end

  def trial_three_days_left(user)
    set_trial_email_vars(user, "mailer_hub_trial_three_days_left_body")
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_three_days_left_subject"))
  end

  def trial_ends_tomorrow(user)
    set_trial_email_vars(user, "mailer_hub_trial_ends_tomorrow_body")
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_ends_tomorrow_subject"))
  end

  def trial_hub_deleted(user)
    set_trial_email_vars(user, "mailer_hub_trial_hub_deleted_body",
      suwali_link: linkify("https://suwali.io"))
    @greeting_name = nil
    mail(to: user.email, from: sales_from, subject: t("mailer_hub_trial_hub_deleted_subject"))
  end

  private

  def sales_from
    ENV.fetch("SALES_EMAIL_FROM", ENV.fetch("EMAIL_FROM", "no-reply@suwali.io"))
  end

  def set_trial_email_vars(user, body_key, **extra)
    @greeting_name = user.name.presence || user.email
    support_email = ENV.fetch("SUPPORT_EMAIL", "support@suwali.io")
    demo_link = AppInfo.schedule_demo_link
    @body = t(body_key,
      support_email: linkify("mailto:#{support_email}", support_email),
      demo_link: linkify(demo_link),
      **extra)
  end

  def linkify(url, label = url)
    "<a href=\"#{url}\" target=\"_blank\" rel=\"noopener noreferrer\">#{label}</a>"
  end
end
