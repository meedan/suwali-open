require "rails_helper"

RSpec.describe "Rate Limiting", type: :request do
  let!(:hub) { create(:hub, invite_code: "ABC123") }

  around { |example| freeze_time { example.run } }

  # Prefills a Rack::Attack throttle counter using the same cache key the
  # middleware uses, avoiding the need to make hundreds of real HTTP requests.
  # Applies the rack-attack discriminator normalizer (lowercases by default) so
  # the key matches what the middleware actually writes.
  def fill_throttle(name, discriminator, period, count)
    normalizer = Rack::Attack.throttle_discriminator_normalizer
    key = normalizer ? normalizer.call(discriminator.to_s) : discriminator.to_s
    count.times { Rack::Attack.cache.count("#{name}:#{key}", period) }
  end

  describe "registration endpoint throttling" do
    it "throttles signup requests by IP after limit exceeded" do
      valid_params = {
        user: {
          email: "user@example.com",
          password: "password123@",
          password_confirmation: "password123@",
          invite_code: "ABC123"
        }
      }

      # Make requests up to the limit (20 in 5 minutes)
      20.times do |i|
        post "/api/signup", params: valid_params.deep_merge(user: {email: "user#{i}@example.com"}), as: :json
      end

      # The 21st request should be throttled
      post "/api/signup", params: valid_params.deep_merge(user: {email: "user21@example.com"}), as: :json

      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["error"]).to include("Too many requests")
    end

    it "includes Retry-After header in throttled response" do
      valid_params = {
        user: {
          email: "user@example.com",
          password: "password123@",
          password_confirmation: "password123@",
          invite_code: "ABC123"
        }
      }

      # Exceed the limit
      21.times do |i|
        post "/api/signup", params: valid_params.deep_merge(user: {email: "user#{i}@example.com"}), as: :json
      end

      expect(response.headers["Retry-After"]).to be_present
    end

    it "throttles signup requests by email after 5 per hour, even from different IPs" do
      target_email = "someone@example.com"
      fill_throttle("registrations/email", target_email, 1.hour, 5)

      post "/api/signup",
        params: {
          user: {
            email: target_email,
            password: "password123@",
            password_confirmation: "password123@",
            invite_code: "ABC123"
          }
        },
        as: :json,
        headers: {"REMOTE_ADDR" => "10.0.0.1"}

      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not 500 when the request body has no user key" do
      fill_throttle("registrations/email", "someone@example.com", 1.hour, 5)

      post "/api/signup", params: {}, as: :json

      expect(response).not_to have_http_status(:internal_server_error)
    end
  end

  describe "wrong invite code handling" do
    it "returns 422 for wrong invite codes (not throttled separately)" do
      wrong_params = {
        user: {
          email: "user@example.com",
          password: "password123@",
          password_confirmation: "password123@",
          invite_code: "WRONG1"
        }
      }

      # Wrong codes return 422, not throttled differently than valid requests
      post "/api/signup", params: wrong_params, as: :json
      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"][0]).to include("invite code")
    end

    it "wrong codes still count toward general rate limit" do
      wrong_params = {
        user: {
          email: "user@example.com",
          password: "password123@",
          password_confirmation: "password123@",
          invite_code: "WRONG1"
        }
      }

      # Make 20 requests with wrong codes (hits general IP limit)
      20.times do |i|
        post "/api/signup", params: wrong_params.deep_merge(user: {email: "user#{i}@example.com"}), as: :json
        expect(response).to have_http_status(:unprocessable_content)
      end

      # The 21st attempt (even with wrong code) should be throttled
      post "/api/signup", params: wrong_params.deep_merge(user: {email: "user21@example.com"}), as: :json
      expect(response).to have_http_status(:too_many_requests)
    end
  end

  describe "sign up endpoint throttling by IP" do
    it "throttles based on IP address" do
      valid_params = {
        user: {
          email: "user@example.com",
          password: "password123@",
          password_confirmation: "password123@",
          invite_code: "ABC123"
        }
      }

      # Make requests from one IP
      20.times do |i|
        post "/api/signup", params: valid_params.deep_merge(user: {email: "user#{i}@example.com"}), as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      end

      # Next request from same IP should be throttled
      post "/api/signup", params: valid_params.deep_merge(user: {email: "user21@example.com"}), as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)

      # But request from different IP should work
      post "/api/signup", params: valid_params.deep_merge(user: {email: "user22@example.com"}), as: :json, headers: {"REMOTE_ADDR" => "5.6.7.8"}
      expect(response).to have_http_status(:ok)
    end
  end

  describe "login endpoint throttling by IP" do
    it "throttles login attempts by IP after 21 per 10 minutes" do
      fill_throttle("logins/ip", "1.2.3.4", 10.minutes, 21)

      post "/api/login", params: {user: {email: "anyone@example.com", password: "wrong"}}, as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle login attempts from a different IP" do
      fill_throttle("logins/ip", "1.2.3.4", 10.minutes, 4)

      post "/api/login", params: {user: {email: "anyone@example.com", password: "wrong"}}, as: :json, headers: {"REMOTE_ADDR" => "5.6.7.8"}
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "login endpoint throttling by email" do
    let(:target_email) { "target@example.com" }

    it "has a real translation for the login rate limit error message" do
      expect(I18n.t(:error_login_attempts_rate_limit_exceeded)).not_to include("translation missing")
    end

    it "throttles login attempts by email after 11 per 10 minutes" do
      fill_throttle("logins/email", target_email, 10.minutes, 11)

      post "/api/login", params: {user: {email: target_email, password: "wrong"}}, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle login attempts below the limit" do
      fill_throttle("logins/email", target_email, 10.minutes, 9)

      post "/api/login", params: {user: {email: target_email, password: "wrong"}}, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "throttles each email independently" do
      fill_throttle("logins/email", target_email, 10.minutes, 11)

      post "/api/login", params: {user: {email: target_email, password: "wrong"}}, as: :json
      expect(response).to have_http_status(:too_many_requests)

      post "/api/login", params: {user: {email: "other@example.com", password: "wrong"}}, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "returns login_attempts_rate_limit_exceeded error code and rate limit message" do
      fill_throttle("logins/email", target_email, 10.minutes, 11)

      post "/api/login", params: {user: {email: target_email, password: "wrong"}}, as: :json
      expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
      expect(response.parsed_body["error"]).to eq(I18n.t(:error_login_attempts_rate_limit_exceeded))
    end
  end

  describe "password reset endpoint throttling" do
    let(:reset_params) { {user: {email: "anyone@example.com"}} }

    it "throttles password reset requests by IP after 10 per hour" do
      10.times do
        post "/api/password", params: reset_params, as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      end

      post "/api/password", params: reset_params, as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle password reset requests from a different IP" do
      10.times do
        post "/api/password", params: reset_params, as: :json, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      end

      post "/api/password", params: reset_params, as: :json, headers: {"REMOTE_ADDR" => "5.6.7.8"}
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "authenticated API throttling" do
    let!(:user) { create(:user) }
    let(:headers) { auth_headers_for(user) }
    let(:token) { headers["Authorization"].split(" ").last }

    it "throttles authenticated requests by token after 300 per minute" do
      fill_throttle("api/token", token, 60, 300)

      get "/api/about", headers: headers
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle authenticated requests at or below the limit" do
      fill_throttle("api/token", token, 60, 299)

      get "/api/about", headers: headers
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "throttles each token independently" do
      user2 = create(:user)
      headers2 = auth_headers_for(user2)
      headers2["Authorization"].split(" ").last

      fill_throttle("api/token", token, 60, 300)

      get "/api/about", headers: headers
      expect(response).to have_http_status(:too_many_requests)

      # Different token is unaffected
      get "/api/about", headers: headers2
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "unauthenticated API throttling" do
    it "throttles unauthenticated API requests by IP after 200 per minute" do
      fill_throttle("api/ip", "1.2.3.4", 60, 200)

      get "/api/about", headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle unauthenticated requests at or below the limit" do
      fill_throttle("api/ip", "1.2.3.4", 60, 199)

      get "/api/about", headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "throttles each IP independently" do
      fill_throttle("api/ip", "1.2.3.4", 60, 200)

      get "/api/about", headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)

      # Different IP is unaffected
      get "/api/about", headers: {"REMOTE_ADDR" => "5.6.7.8"}
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "resend confirmation endpoint throttling" do
    let(:target_email) { "someone@example.com" }

    it "throttles resend requests by IP after 10 per hour" do
      fill_throttle("resends/ip", "1.2.3.4", 1.hour, 10)

      post "/api/resends", params: {user: {email: target_email}}, headers: {"REMOTE_ADDR" => "1.2.3.4"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "throttles resend requests by email after 5 per hour, even from different IPs" do
      fill_throttle("resends/email", target_email, 1.hour, 5)

      post "/api/resends", params: {user: {email: target_email}}, as: :json, headers: {"REMOTE_ADDR" => "10.0.0.1"}
      expect(response).to have_http_status(:too_many_requests)
    end
  end

  describe "sources/configure throttling" do
    let!(:user) { create(:user) }
    let(:headers) { auth_headers_for(user) }
    let(:token) { headers["Authorization"].split(" ").last }

    it "throttles configure requests by token after 10 per 10 minutes" do
      fill_throttle("api/sources/configure", token, 10.minutes, 10)

      post "/api/sources/configure", headers: headers, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle configure requests at or below the limit" do
      fill_throttle("api/sources/configure", token, 10.minutes, 9)

      post "/api/sources/configure", headers: headers, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "throttles each token independently" do
      user2 = create(:user)
      headers2 = auth_headers_for(user2)

      fill_throttle("api/sources/configure", token, 10.minutes, 10)

      post "/api/sources/configure", headers: headers, as: :json
      expect(response).to have_http_status(:too_many_requests)

      post "/api/sources/configure", headers: headers2, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "sources/detect_wordpress throttling" do
    let!(:user) { create(:user) }
    let(:headers) { auth_headers_for(user) }
    let(:token) { headers["Authorization"].split(" ").last }

    it "throttles detection requests by token after 30 per 10 minutes" do
      fill_throttle("api/sources/detect_wordpress", token, 10.minutes, 30)

      post "/api/sources/detect_wordpress", headers: headers, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle detection requests at or below the limit" do
      fill_throttle("api/sources/detect_wordpress", token, 10.minutes, 29)

      post "/api/sources/detect_wordpress", headers: headers, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "me/password throttling" do
    let!(:user) { create(:user) }
    let(:headers) { auth_headers_for(user) }
    let(:token) { headers["Authorization"].split(" ").last }
    let(:params) do
      {user: {current_password: "wrong", password: "newPassword123@", password_confirmation: "newPassword123@"}}
    end

    it "throttles password-change requests by token after 20 per 15 minutes" do
      fill_throttle("api/me/password", token, 15.minutes, 20)

      patch "/api/me/password", params: params, headers: headers, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle password-change requests at or below the limit" do
      fill_throttle("api/me/password", token, 15.minutes, 19)

      patch "/api/me/password", params: params, headers: headers, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end

    it "throttles each token independently" do
      user2 = create(:user)
      headers2 = auth_headers_for(user2)

      fill_throttle("api/me/password", token, 15.minutes, 20)

      patch "/api/me/password", params: params, headers: headers, as: :json
      expect(response).to have_http_status(:too_many_requests)

      patch "/api/me/password", params: params, headers: headers2, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  describe "path variants the router also accepts" do
    ip = "1.2.3.4"
    email = "someone@example.com"

    [
      ["registrations/ip", "/api/signup", 5.minutes, 20, ip],
      ["registrations/email", "/api/signup", 1.hour, 5, email],
      ["logins/ip", "/api/login", 10.minutes, 20, ip],
      ["logins/email", "/api/login", 10.minutes, 10, email],
      ["passwords/ip", "/api/password", 1.hour, 10, ip],
      ["resends/ip", "/api/resends", 1.hour, 10, ip],
      ["resends/email", "/api/resends", 1.hour, 5, email]
    ].each do |name, path, period, limit, discriminator|
      ["#{path}.json", "#{path}/"].each do |variant|
        it "applies #{name} to #{variant}" do
          fill_throttle(name, discriminator, period, limit)

          post variant, params: {user: {email: email}}, as: :json, headers: {"REMOTE_ADDR" => ip}
          expect(response).to have_http_status(:too_many_requests)
        end
      end
    end
  end

  describe "webhook safelist" do
    it "does not throttle webhook endpoints even when the IP limit is exceeded" do
      fill_throttle("api/ip", "1.2.3.4", 60, 200)

      # Webhook path is safelisted; response may be an error but must not be 429
      post "/api/webhooks/telegram/999", headers: {"REMOTE_ADDR" => "1.2.3.4"}, as: :json
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end

  # Guards how real_ip resolves the throttle key from request headers. Uses
  # passwords/ip (limit 10/hr, no email fallback) as the cleanest signal.
  describe "real IP resolution (header trust)" do
    let(:reset_params) { {user: {email: "anyone@example.com"}} }

    it "throttles by the Cloudflare-provided client IP" do
      fill_throttle("passwords/ip", "2.2.2.2", 1.hour, 10)

      post "/api/password", params: reset_params, as: :json,
        headers: {"HTTP_CF_CONNECTING_IP" => "2.2.2.2"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "ignores a forged X-Forwarded-For when keying the throttle" do
      # The bucket for the real connecting IP is already full.
      fill_throttle("passwords/ip", "1.2.3.4", 1.hour, 10)

      # Attacker sends a spoofed leftmost XFF hoping for a fresh bucket.
      # real_ip must fall back to req.ip (1.2.3.4), not trust the header.
      post "/api/password", params: reset_params, as: :json,
        headers: {"REMOTE_ADDR" => "1.2.3.4", "HTTP_X_FORWARDED_FOR" => "9.9.9.9"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "prefers CF-Connecting-IP over X-Forwarded-For when both are present" do
      fill_throttle("passwords/ip", "2.2.2.2", 1.hour, 10)

      # Key is the CF IP (full), not the spoofed XFF IP (empty) -> still throttled.
      post "/api/password", params: reset_params, as: :json,
        headers: {"HTTP_CF_CONNECTING_IP" => "2.2.2.2", "HTTP_X_FORWARDED_FOR" => "9.9.9.9"}
      expect(response).to have_http_status(:too_many_requests)
    end

    it "does not throttle a genuinely different Cloudflare client IP" do
      fill_throttle("passwords/ip", "2.2.2.2", 1.hour, 10)

      post "/api/password", params: reset_params, as: :json,
        headers: {"HTTP_CF_CONNECTING_IP" => "3.3.3.3"}
      expect(response).not_to have_http_status(:too_many_requests)
    end
  end
end
