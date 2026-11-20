require "rails_helper"

RSpec.describe "Users API", type: :request do
  let(:user) { create(:user) }

  it "returns 401 when accessing /me without a token" do
    get "/api/me", as: :json

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("You need to sign in or sign up before continuing.")
  end

  describe "activity tracking" do
    it "returns your own activity timestamps at /me" do
      user.update_columns(last_login_at: 2.days.ago, last_active_at: 2.days.ago)

      get "/api/me", headers: auth_headers_for(user)

      expect(response.parsed_body["user"]["last_login_at"]).to be_present
      expect(response.parsed_body["user"]["last_active_at"]).to be_present
    end

    it "refreshes last_active_at on an authenticated request once the throttle window has passed" do
      headers = auth_headers_for(user)
      user.update_columns(last_active_at: (User::ACTIVITY_THROTTLE + 1.minute).ago)

      get "/api/me", headers: headers

      expect(user.reload.last_active_at).to be_within(5.seconds).of(Time.current)
    end

    it "leaves last_active_at alone while it is still within the throttle window" do
      headers = auth_headers_for(user)
      recent = 1.minute.ago
      user.update_columns(last_active_at: recent)

      get "/api/me", headers: headers

      expect(user.reload.last_active_at).to be_within(1.second).of(recent)
    end
  end

  it "returns current user info at /me" do
    # Login to get JWT
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    # Access /me with the token
    user.hubs << create(:hub)
    get "/api/me", headers: {"Authorization" => token}
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["user"]["email"]).to eq(user.email)
    expect(response.parsed_body["user"]["id"]).to eq(user.id)
    expect(response.parsed_body["user"]["hubs"]).not_to be_empty
  end

  it "returns 401 when patching /me without a token" do
    patch "/api/me", as: :json

    expect(response).to have_http_status(:unauthorized)
    expect(response.parsed_body["error"]).to eq("You need to sign in or sign up before continuing.")
  end

  it "updates current user info at /me" do
    # Login to get JWT
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    # Patch /me with the token
    patch "/api/me", params: {user: {name: "New Name"}}, headers: {"Authorization" => token}
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["email"]).to eq(user.email)
    expect(response.parsed_body["id"]).to eq(user.id)
    expect(response.parsed_body["name"]).to eq("New Name")
  end

  it "fails when trying to update current user" do
    # Login to get JWT
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    patch "/api/me", params: {user: {name: ("XYZ" * 35)}}, headers: {"Authorization" => token}
    expect(response).to have_http_status(:unprocessable_content)
  end

  it "returns 401 when patching /me/password without a token" do
    patch "/api/me/password", as: :json

    expect(response).to have_http_status(:unauthorized)
  end

  it "changes the current user's password and dispatches a fresh JWT" do
    # Login to get JWT
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    patch "/api/me/password", params: {
      user: {
        current_password: "password123@",
        password: "newPassword123@",
        password_confirmation: "newPassword123@"
      }
    }, headers: {"Authorization" => token}

    expect(response).to have_http_status(:ok)
    expect(response.headers["Authorization"]).to be_present
    expect(user.reload.valid_password?("newPassword123@")).to be true

    # The freshly dispatched token must actually work on the very next
    # request, immediately, in the same wall-clock second as the password
    # change - not be treated as issued before it (see JwtDenylist).
    new_token = response.headers["Authorization"]
    get "/api/me", headers: {"Authorization" => new_token}, as: :json

    expect(response).to have_http_status(:ok)
  end

  it "fails to change password when current_password is wrong" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    patch "/api/me/password", params: {
      user: {
        current_password: "wrongPassword123@",
        password: "newPassword123@",
        password_confirmation: "newPassword123@"
      }
    }, headers: {"Authorization" => token}

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).not_to be_empty
  end

  it "fails to change password when confirmation does not match" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    patch "/api/me/password", params: {
      user: {
        current_password: "password123@",
        password: "newPassword123@",
        password_confirmation: "somethingElse123@"
      }
    }, headers: {"Authorization" => token}

    expect(response).to have_http_status(:unprocessable_content)
  end

  it "fails to change password when no new password is given" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json
    token = response.headers["Authorization"]

    patch "/api/me/password", params: {
      user: {
        current_password: "password123@"
      }
    }, headers: {"Authorization" => token}

    expect(response).to have_http_status(:unprocessable_content)
    expect(user.reload.valid_password?("password123@")).to be true
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Users API" do
  path "/api/me" do
    get "Gets information about authenticated user" do
      tags "User"
      produces "application/json"
      security [bearerAuth: []]

      response "200", "User authenticated" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "User not authenticated" do
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end

    patch "Updates information about authenticated user" do
      tags "User"
      produces "application/json"
      consumes "multipart/form-data"
      security [bearerAuth: []]

      parameter name: :user, in: :formData, schema: {
        type: :object,
        properties: {
          "user[name]": {type: :string, example: "New Name"},
          "user[profile_picture]": {type: :string, format: :binary}
        }
      }

      response "200", "User updated" do
        let!(:existing_user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(existing_user, :user, nil)
          "Bearer #{token}"
        end
        let(:user) { {"user" => {name: "New Name"}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "User not authenticated" do
        let(:Authorization) { nil }
        let(:user) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "422", "User not updated" do
        let!(:existing_user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(existing_user, :user, nil)
          "Bearer #{token}"
        end
        let(:user) { {"name" => ("XYZ" * 35)} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/me/password" do
    patch "Changes the authenticated user's password" do
      tags "User"
      produces "application/json"
      consumes "application/json"
      security [bearerAuth: []]

      parameter name: :user, in: :body, schema: {
        type: :object,
        properties: {
          user: {
            type: :object,
            properties: {
              current_password: {type: :string, example: "password123@"},
              password: {type: :string, example: "newPassword123@"},
              password_confirmation: {type: :string, example: "newPassword123@"}
            }
          }
        }
      }

      response "200", "Password changed" do
        let!(:existing_user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(existing_user, :user, nil)
          "Bearer #{token}"
        end
        let(:user) do
          {user: {current_password: "password123@", password: "newPassword123@", password_confirmation: "newPassword123@"}}
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(response.headers["Authorization"]).to be_present
        end
      end

      response "401", "User not authenticated" do
        let(:Authorization) { nil }
        let(:user) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "422", "Current password is invalid" do
        let!(:existing_user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(existing_user, :user, nil)
          "Bearer #{token}"
        end
        let(:user) do
          {user: {current_password: "wrongPassword123@", password: "newPassword123@", password_confirmation: "newPassword123@"}}
        end
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end
end
