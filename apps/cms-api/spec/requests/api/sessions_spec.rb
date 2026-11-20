require "rails_helper"

RSpec.describe "User Sessions API", type: :request do
  let(:user) { create(:user) }

  it "logs in with valid credentials" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["message"]).to eq("Logged in successfully")
    expect(response.headers["Authorization"]).to be_present
  end

  it "records the login timestamp and returns it" do
    user.update_columns(last_login_at: nil, last_active_at: nil)

    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json

    expect(response.parsed_body["user"]["last_login_at"]).to be_present
    expect(user.reload.last_login_at).to be_within(5.seconds).of(Time.current)
    expect(user.last_active_at).to be_within(5.seconds).of(Time.current)
  end

  it "does not error on GET /api/login, which carries no persisted user" do
    get "/api/login", as: :json

    expect(response).to have_http_status(:ok)
  end

  it "does not record a login timestamp for a failed login" do
    user.update_columns(last_login_at: nil)

    post "/api/login", params: {
      user: {
        email: user.email,
        password: "wrong"
      }
    }, as: :json

    expect(user.reload.last_login_at).to be_nil
  end

  it "logs out successfully" do
    # Login first to get token
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json

    token = response.headers["Authorization"]
    delete "/api/logout", headers: {"Authorization" => token}

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["message"]).to include("Logged out")
  end

  it "fails login with invalid credentials" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "wrong"
      }
    }, as: :json

    expect(response).to have_http_status(:unauthorized)
    body = response.parsed_body

    expect(body["error_code"]).to eq("invalid_credentials")
    expect(body["error"]).to eq(I18n.t("devise.failure.invalid", authentication_keys: "email"))
  end

  it "rejects a token after logout" do
    post "/api/login", params: {
      user: {
        email: user.email,
        password: "password123@"
      }
    }, as: :json

    token = response.headers["Authorization"]

    delete "/api/logout", headers: {"Authorization" => token}
    expect(response).to have_http_status(:ok)

    get "/api/me", headers: {"Authorization" => token}
    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects tokens issued before password change" do
    headers = auth_headers_for(user)

    user.update!(password: "newPassword1@", password_confirmation: "newPassword1@")

    get "/api/me", headers: headers
    expect(response).to have_http_status(:unauthorized)
  end

  it "fails login with unconfirmed_email when credentials are valid but account is unconfirmed" do
    password = "password123@"
    unconfirmed_user = create(
      :user,
      email: "unconfirmed@example.org",
      password: password,
      confirmed_at: nil
    )

    post "/api/login", params: {
      user: {
        email: unconfirmed_user.email,
        password: password
      }
    }, as: :json

    expect(response).to have_http_status(:unauthorized)
    body = response.parsed_body

    expect(body["error_code"]).to eq("unconfirmed_email")
    expect(body["error"]).to eq(I18n.t("devise.failure.unconfirmed"))
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Sessions API" do
  path "/api/login" do
    post "Logs in as a user" do
      tags "User"
      consumes "application/json"
      parameter name: :user, in: :body, schema: {
        type: :object,
        properties: {
          user: {
            type: :object,
            properties: {
              email: {type: :string, example: "foo@bar.test"},
              password: {type: :string, example: "foobar123@"}
            },
            required: ["email", "password"]
          }
        },
        required: ["user"]
      }

      response "200", "Logged in successfully" do
        let!(:test_user) do
          create(:user,
            email: "foo@bar.test",
            password: "foobar123@",
            password_confirmation: "foobar123@",
            confirmed_at: Time.current)
        end
        let(:user) { {"user" => {email: "foo@bar.test", password: "foobar123@"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Invalid request" do
        let!(:test_user) do
          create(:user,
            email: "foo@bar.test",
            password: "foobar123@",
            password_confirmation: "foobar123@",
            confirmed_at: Time.current)
        end
        let(:user) { {"user" => {email: "foo@bar.test", password: "foobar456@"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end

  path "/api/logout" do
    delete "Logs out as a user" do
      tags "User"
      security [bearerAuth: []]

      response "200", "Logged out successfully" do
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end
    end
  end
end
