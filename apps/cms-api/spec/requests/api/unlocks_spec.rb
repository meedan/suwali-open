require "rails_helper"

RSpec.describe "Unlocks API", type: :request do
  let(:user) { create(:user) }

  before { user.lock_access! }

  it "unlocks the account via a valid token and redirects to the frontend login page" do
    token = user.send_unlock_instructions

    get "/api/unlock", params: {unlock_token: token}

    expect(response).to redirect_to(%r{/login\?unlocked=true})
    expect(user.reload).not_to be_access_locked
  end

  it "redirects to the frontend error page when the unlock token is invalid" do
    get "/api/unlock", params: {unlock_token: "invalid_token"}

    expect(response).to redirect_to(%r{/login\?unlock_failed=true})
  end

  it "sends an unlock instructions email when resend is requested" do
    expect {
      post "/api/unlock", params: {user: {email: user.email}}, as: :json
    }.to change { ActionMailer::Base.deliveries.count }.by(1)

    expect(response).to have_http_status(:ok)
  end
end
