module Rack
  class SilenceHealthCheckLogs
    def initialize(app)
      @app = app
    end

    def call(env)
      if env["PATH_INFO"] == "/health"
        Rails.logger.silence { @app.call(env) }
      else
        @app.call(env)
      end
    end
  end
end

Rails.application.config.middleware.insert_before Rails::Rack::Logger, Rack::SilenceHealthCheckLogs
