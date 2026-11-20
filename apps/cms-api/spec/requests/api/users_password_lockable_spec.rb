require "rails_helper"

RSpec.describe "Change password lockable", type: :request do
  let(:user) { create(:user) }
  let(:token) do
    post "/api/login", params: {user: {email: user.email, password: "password123@"}}, as: :json
    response.headers["Authorization"]
  end

  it "rejects an already-locked account before it can even attempt a password change" do
    token # log in while the account is still unlocked, before locking it below
    user.lock_access!

    patch "/api/me/password", params: {
      user: {current_password: "password123@", password: "newPassword123@", password_confirmation: "newPassword123@"}
    }, headers: {"Authorization" => token}, as: :json

    # Rejected by Devise's global activatable Warden hook (authenticate_user!),
    # the same way any other endpoint would reject a locked account's token.
    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
  end

  # The frontend sends no Accept header, so routes outside devise_for (which defaults
  # to :json) reach the failure app as */*. It must still answer JSON.
  it "rejects a locked account with JSON when the request does not ask for it" do
    token
    user.lock_access!

    get "/api/me", headers: {"Authorization" => token, "HTTP_ACCEPT" => "*/*"}

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
  end

  it "locks the account after 10 wrong current_password attempts" do
    9.times do
      patch "/api/me/password", params: {
        user: {current_password: "wrong", password: "newPassword123@", password_confirmation: "newPassword123@"}
      }, headers: {"Authorization" => token}, as: :json
    end
    patch "/api/me/password", params: {
      user: {current_password: "wrong", password: "newPassword123@", password_confirmation: "newPassword123@"}
    }, headers: {"Authorization" => token}, as: :json

    expect(response).to have_http_status(:too_many_requests)
    expect(response.parsed_body["error_code"]).to eq("login_attempts_rate_limit_exceeded")
    expect(user.reload).to be_access_locked
  end

  it "does not lock the account before 10 wrong attempts" do
    9.times do
      patch "/api/me/password", params: {
        user: {current_password: "wrong", password: "newPassword123@", password_confirmation: "newPassword123@"}
      }, headers: {"Authorization" => token}, as: :json
    end

    expect(response).to have_http_status(:unprocessable_content)
    expect(user.reload).not_to be_access_locked
  end

  it "resets failed_attempts to 0 after a successful password change" do
    3.times do
      patch "/api/me/password", params: {
        user: {current_password: "wrong", password: "newPassword123@", password_confirmation: "newPassword123@"}
      }, headers: {"Authorization" => token}, as: :json
    end

    patch "/api/me/password", params: {
      user: {current_password: "password123@", password: "newPassword123@", password_confirmation: "newPassword123@"}
    }, headers: {"Authorization" => token}, as: :json

    expect(response).to have_http_status(:ok)
    expect(user.reload.failed_attempts).to eq(0)
  end
end
