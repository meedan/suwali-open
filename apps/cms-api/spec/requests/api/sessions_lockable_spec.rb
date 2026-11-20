require "rails_helper"

RSpec.describe "Account Lockable", type: :request do
  let(:user) { create(:user) }

  it "returns login_attempts_rate_limit_exceeded error code when a locked account attempts to log in" do
    user.lock_access!

    post "/api/login", params: {user: {email: user.email, password: "password123@"}}, as: :json

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
    expect(response.parsed_body["error"]).to eq(I18n.t(:error_login_attempts_rate_limit_exceeded))
  end

  it "auto-unlocks the account after the unlock_in period elapses" do
    user.lock_access!

    travel_to 11.minutes.from_now do
      post "/api/login", params: {user: {email: user.email, password: "password123@"}}, as: :json
    end

    expect(response).to have_http_status(:ok)
  end

  it "resets failed_attempts to 0 after a successful login" do
    3.times do
      post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json
    end

    post "/api/login", params: {user: {email: user.email, password: "password123@"}}, as: :json

    expect(user.reload.failed_attempts).to eq(0)
  end

  it "unlocks the account when the password is reset" do
    user.lock_access!
    token = user.send_reset_password_instructions

    put "/api/password", params: {
      user: {
        reset_password_token: token,
        password: "NewPass1!",
        password_confirmation: "NewPass1!"
      }
    }, as: :json

    expect(user.reload).not_to be_access_locked
  end

  describe "account enumeration prevention" do
    let(:nonexistent_email) { "nobody@example.com" }
    let(:rate_limit_text) { I18n.t(:error_login_attempts_rate_limit_exceeded) }

    before { Rack::Attack.cache.store.clear }

    it "blocks the 10th attempt for an existing account with 429" do
      9.times { post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json }
      post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json

      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
      expect(response.parsed_body["error"]).to eq(rate_limit_text)
    end

    it "blocks the 11th attempt for a non-existing email with 429" do
      10.times { post "/api/login", params: {user: {email: nonexistent_email, password: "wrong"}}, as: :json }
      post "/api/login", params: {user: {email: nonexistent_email, password: "wrong"}}, as: :json

      expect(response).to have_http_status(:too_many_requests)
      expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
      expect(response.parsed_body["error"]).to eq(rate_limit_text)
    end

    it "returns identical response for existing and non-existing accounts at the limit" do
      9.times { post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json }
      post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json
      existing_body = response.parsed_body

      Rack::Attack.cache.store.clear
      10.times { post "/api/login", params: {user: {email: nonexistent_email, password: "wrong"}}, as: :json }
      post "/api/login", params: {user: {email: nonexistent_email, password: "wrong"}}, as: :json

      expect(response.parsed_body).to eq(existing_body)
    end

    it "does not return last_attempt_warning on any attempt" do
      error_codes = []
      9.times do
        post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json
        error_codes << response.parsed_body["error_code"]
      end

      expect(error_codes).not_to include("last_attempt_warning")
    end

    it "allows fewer than 10 attempts through (9th attempt is not 429)" do
      9.times { post "/api/login", params: {user: {email: user.email, password: "wrong"}}, as: :json }

      expect(response).not_to have_http_status(:too_many_requests)
    end
  end
end
