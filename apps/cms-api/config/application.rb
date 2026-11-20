require_relative "boot"

require "rails"
# Pick the frameworks you want:
require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "active_storage/engine"
require "action_controller/railtie"
require "action_mailer/railtie"
require "action_mailbox/engine"
require "action_text/engine"
require "action_view/railtie"
require "action_cable/engine"
# require "rails/test_unit/railtie"

# Require the gems listed in Gemfile, including any gems
# you've limited to :test, :development, or :production.
Bundler.require(*Rails.groups)

module SuwaliCmsApi
  class Application < Rails::Application
    # Initialize configuration defaults for originally generated Rails version.
    config.load_defaults 7.1

    # Please, add to the `ignore` list any other `lib` subdirectories that do
    # not contain `.rb` files, or that should not be reloaded or eager loaded.
    # Common ones are `templates`, `generators`, or `middleware`, for example.
    config.autoload_lib(ignore: %w[assets tasks])

    # Configuration for the application, engines, and railties goes here.
    #
    # These settings can be overridden in specific environments using the files
    # in config/environments, which are processed later.
    #
    # config.time_zone = "Central Time (US & Canada)"
    # config.eager_load_paths << Rails.root.join("extras")

    # Only loads a smaller set of middleware suitable for API only apps.
    # Middleware like session, flash, cookies can be added back manually.
    # Skip views, helpers and assets when generating a new resource.
    config.api_only = true

    config.generators do |g|
      g.test_framework :rspec,
        fixtures: true,
        view_specs: false,
        helper_specs: false,
        routing_specs: false,
        controller_specs: true,
        request_specs: false
      g.fixture_replacement :factory_bot, dir: "spec/factories"
    end

    config.action_mailer.delivery_method = :smtp
    external_url = URI.parse(ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000"))
    config.action_mailer.default_url_options = {host: external_url.host, port: external_url.port, protocol: external_url.scheme}
    config.action_mailer.smtp_settings = {address: ENV["SMTP_HOST"], port: ENV["SMTP_PORT"]}
    config.active_job.queue_adapter = :sidekiq

    # Enable session middleware ONLY for Sidekiq::Web
    config.middleware.use ActionDispatch::Cookies
    config.middleware.use ActionDispatch::Session::CookieStore, key: "_suwali_cms_api_app_session"

    # Rate limiting
    config.middleware.use Rack::Attack

    config.active_storage.service = :s3
    config.active_storage.analyze = false # Disable creating Sidekiq jobs for retrieving metadata from attachments
    config.active_storage.service_urls_expire_in = 1.week

    # l10n — available_locales is set from SUPPORTED_LANGUAGES in config/initializers/languages.rb
    config.i18n.default_locale = :en
    config.i18n.fallbacks = true
    config.i18n.enforce_available_locales = false

    config.active_record.schema_format = :sql

    config.active_record.encryption.primary_key = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"]
    config.active_record.encryption.deterministic_key = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"]
    config.active_record.encryption.key_derivation_salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"]
    # Allow reading legacy plaintext credentials during the transition period.
    # Once all MessagingIntegration records are confirmed encrypted, this can be removed.
    config.active_record.encryption.support_unencrypted_data = true
  end
end
