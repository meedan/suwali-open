class Rack::Attack
  # Trust only Cloudflare's CF-Connecting-IP; X-Forwarded-For is client-forgeable (CWE-290).
  def self.real_ip(req)
    cf_ip = req.get_header("HTTP_CF_CONNECTING_IP")
    cf_ip || req.ip
  end

  # Normalizes the path the way the router does, so /api/login.json or /api/login/ can't skip a throttle.
  def self.route_path(req)
    req.path.squeeze("/").delete_suffix("/").sub(/\.[^\/.]+\z/, "")
  end

  # Use Rails cache for Rack::Attack
  redis_url = ENV["REDIS_RACK_ATTACK_URL"] || ENV.fetch("REDIS_URL", "redis://redis:6379/1")
  puts "Using Redis at #{redis_url} for Rack::Attack store"

  redis_opts = {url: redis_url}

  if Rails.env.production?
    redis_opts[:ssl] = true
    redis_opts[:ssl_params] = {
      verify_mode: 1 # OpenSSL::SSL::VERIFY_PEER
    }
  end

  Rack::Attack.enabled = false if Rails.env.development?

  Rack::Attack.cache.store = ActiveSupport::Cache::RedisCacheStore.new(**redis_opts)

  # Webhooks come from trusted external services (Telegram, WhatsApp) - exempt from all throttles
  safelist("webhooks") do |req|
    route_path(req).start_with?("/api/webhooks/")
  end

  # Throttle signup attempts by real IP: 20 per 5 minutes
  throttle("registrations/ip", limit: 20, period: 5.minutes) do |req|
    real_ip(req) if route_path(req) == "/api/signup" && req.post?
  end

  # Throttle signup attempts by target email: 5 per hour.
  # Prevents email-bombing a specific address even from rotating IPs.
  throttle("registrations/email", limit: 5, period: 1.hour) do |req|
    if route_path(req) == "/api/signup" && req.post?
      ActionDispatch::Request.new(req.env).params.dig("user", "email")&.downcase&.strip&.presence
    end
  end

  # Throttle login attempts by real IP: 20 per 10 minutes.
  # Sits above the edge's 10 failed responses per 10 minutes, so an origin 429
  # does not arrive before that block.
  throttle("logins/ip", limit: 20, period: 10.minutes) do |req|
    real_ip(req) if route_path(req) == "/api/login" && req.post?
  end

  # Throttle login attempts by email: 10 per 10 minutes.
  # Existing accounts lock via Devise at attempt 10 (unlock email sent).
  # Non-existing emails are blocked by this throttle on the 11th attempt.
  # Keep limit/period equal to Devise maximum_attempts/unlock_in: a lower limit
  # would block the locking attempt (no unlock email), any other mismatch lets
  # responses reveal which emails have accounts.
  throttle("logins/email", limit: 10, period: 10.minutes) do |req|
    if route_path(req) == "/api/login" && req.post?
      ActionDispatch::Request.new(req.env).params.dig("user", "email")&.strip&.downcase&.presence
    end
  end

  # Throttle password reset requests by real IP: 10 per hour
  throttle("passwords/ip", limit: 10, period: 1.hour) do |req|
    real_ip(req) if route_path(req) == "/api/password" && req.post?
  end

  # Throttle confirmation resend requests by real IP: 10 per hour
  throttle("resends/ip", limit: 10, period: 1.hour) do |req|
    real_ip(req) if route_path(req) == "/api/resends" && req.post?
  end

  # Throttle confirmation resend requests by target email: 5 per hour.
  # Prevents email-bombing a specific address even from rotating IPs.
  throttle("resends/email", limit: 5, period: 1.hour) do |req|
    if route_path(req) == "/api/resends" && req.post?
      ActionDispatch::Request.new(req.env).params.dig("user", "email")&.downcase&.strip&.presence
    end
  end

  # Throttle admin export endpoints by Bearer token: 10 per 5 minutes.
  # Exports run expensive aggregates across all hubs — keep rate low.
  throttle("admin/exports/token", limit: 10, period: 5.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req).start_with?("/api/admin/export/") && !token.nil?
  end

  # Throttle authenticated API requests by Bearer token: 300 per minute.
  # Uses the token directly - avoids depending on Warden middleware order.
  throttle("api/token", limit: 300, period: 1.minute) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req).start_with?("/api/") && !token.nil?
  end

  # Throttle unauthenticated API requests by IP: 200 per minute.
  # Covers any /api/ request that carries no Bearer token.
  throttle("api/ip", limit: 200, period: 1.minute) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    real_ip(req) if route_path(req).start_with?("/api/") && token.nil?
  end

  # Throttle sources/configure endpoint by Bearer token: 10 per 10 minutes.
  # The configure endpoint makes a call to LLM — keep rate low.
  throttle("api/sources/configure", limit: 10, period: 10.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req) == "/api/sources/configure" && req.post?
  end

  # Throttle sources/detect_wordpress by Bearer token: 30 per 10 minutes.
  throttle("api/sources/detect_wordpress", limit: 30, period: 10.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req) == "/api/sources/detect_wordpress" && req.post?
  end

  # Throttle sources/ownership_code by Bearer token: 20 per 10 minutes.
  # Each call reads an arbitrary site's API index to see whether it supports Application Passwords.
  throttle("api/sources/ownership_code", limit: 20, period: 10.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req) == "/api/sources/ownership_code" && req.post?
  end

  # Throttle sources/verify_ownership by Bearer token: 20 per 10 minutes.
  # Each call fetches an arbitrary site's tagline — keep it from being used to hammer sites.
  throttle("api/sources/verify_ownership", limit: 20, period: 10.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req) == "/api/sources/verify_ownership" && req.post?
  end

  # Throttle password-change attempts by Bearer token: 20 per 15 minutes.
  # Guards against brute-forcing current_password on an authenticated session.
  throttle("api/me/password", limit: 20, period: 15.minutes) do |req|
    token = req.get_header("HTTP_AUTHORIZATION")&.split(" ")&.last
    token if route_path(req) == "/api/me/password" && req.patch?
  end

  # Per-throttle custom responses. Throttles not listed here get the generic response.
  THROTTLE_RESPONSES = {
    "logins/email" => ["login_attempts_rate_limit_exceeded", :error_login_attempts_rate_limit_exceeded],
    "logins/ip" => ["login_attempts_rate_limit_exceeded", :error_login_attempts_rate_limit_exceeded]
  }.freeze

  # Custom response for throttled requests
  self.throttled_responder = lambda do |request|
    match_data = request.env["rack.attack.match_data"]
    matched = request.env["rack.attack.matched"]
    retry_after = match_data[:period] - (Time.now.to_i % match_data[:period])

    error_code, i18n_key = THROTTLE_RESPONSES.fetch(matched, ["rate_limit_exceeded", :error_rate_limit_exceeded])

    [
      429,
      {
        "Content-Type" => "application/json",
        "Retry-After" => retry_after.to_s
      },
      [{error: I18n.t(i18n_key), error_code: error_code}.to_json]
    ]
  end
end
