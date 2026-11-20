env = ENV["DEPLOY_ENV"] || "local"
dsn = ENV["SENTRY_DSN"] || ""

if dsn != "" && env != "local"
  Sentry.init do |config|
    config.dsn = dsn
    config.breadcrumbs_logger = [:active_support_logger, :http_logger]
    config.send_default_pii = false
    config.traces_sample_rate = 0.2
    config.profiles_sample_rate = 0.2
    config.environment = env
  end

  puts "Sentry initialized"
else
  puts "Sentry is not enabled for #{env} environment"
end
