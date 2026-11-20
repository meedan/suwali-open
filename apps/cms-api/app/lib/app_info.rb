class AppInfo
  NAME = "Suwali CMS API"
  PLATFORMS = {
    internal: 0,
    telegram: 1,
    whatsapp: 2,
    sms: 3,
    signal: 4
  }.freeze

  # Used by trial emails and served to the frontend via /about
  def self.schedule_demo_link
    ENV.fetch("SCHEDULE_DEMO_LINK", "https://suwali.io/demo")
  end
end
