require "rails_helper"

RSpec.describe "User Password Reset API", type: :request do
  let(:user) { create(:user) }

  describe "POST /api/password" do
    it "sends password reset instructions with valid email" do
      post "/api/password", params: {
        user: {
          email: user.email
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["message"]).to include("email address")
    end

    it "returns success even with invalid email (security)" do
      post "/api/password", params: {
        user: {
          email: "nonexistent@example.com"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["message"]).to include("email address")
    end

    it "fails with missing email parameter" do
      post "/api/password", params: {
        user: {}
      }, as: :json

      expect(response).to have_http_status(:bad_request)
    end
  end

  # The reset email links straight to the frontend, so the API no longer serves the edit page
  describe "GET /api/password/edit", type: :routing do
    it "is not routable" do
      expect(get: "/api/password/edit").not_to be_routable
    end
  end

  describe "PUT /api/password" do
    let(:raw_token) do
      raw, encrypted = Devise.token_generator.generate(User, :reset_password_token)
      user.update!(
        reset_password_token: encrypted,
        reset_password_sent_at: Time.current
      )
      raw
    end

    it "resets password with valid token and password" do
      put "/api/password", params: {
        user: {
          reset_password_token: raw_token,
          password: "newpassword123@",
          password_confirmation: "newpassword123@"
        }
      }, as: :json

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["message"]).to include("reset successfully")
    end

    it "fails with invalid token" do
      put "/api/password", params: {
        user: {
          reset_password_token: "invalid_token",
          password: "newpassword123@",
          password_confirmation: "newpassword123@"
        }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "fails with password confirmation mismatch" do
      put "/api/password", params: {
        user: {
          reset_password_token: raw_token,
          password: "newpassword123@",
          password_confirmation: "different123@"
        }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "fails with weak password" do
      put "/api/password", params: {
        user: {
          reset_password_token: raw_token,
          password: "weak",
          password_confirmation: "weak"
        }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end

    it "fails with expired token" do
      # Create token that's older than reset_password_within (6 hours)
      raw, encrypted = Devise.token_generator.generate(User, :reset_password_token)
      user.update!(
        reset_password_token: encrypted,
        reset_password_sent_at: 7.hours.ago
      )

      put "/api/password", params: {
        user: {
          reset_password_token: raw,
          password: "newpassword123@",
          password_confirmation: "newpassword123@"
        }
      }, as: :json

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"]).to be_present
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Passwords API" do
  path "/api/password" do
    post "Request password reset" do
      tags "User"
      consumes "application/json"
      parameter name: :user, in: :body, schema: {
        type: :object,
        properties: {
          user: {
            type: :object,
            properties: {
              email: {type: :string, example: "user@example.com"}
            },
            required: ["email"]
          }
        },
        required: ["user"]
      }

      response "200", "Password reset instructions sent" do
        let!(:test_user) { create(:user, email: "user@example.com") }
        let(:user) { {"user" => {email: "user@example.com"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(response.parsed_body["message"]).to include("email address")
        end
      end

      response "400", "Missing parameters" do
        let(:user) { {} }  # Missing user parameter entirely
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:bad_request)
        end
      end
    end

    put "Reset password" do
      tags "User"
      consumes "application/json"
      parameter name: :user, in: :body, schema: {
        type: :object,
        properties: {
          user: {
            type: :object,
            properties: {
              reset_password_token: {type: :string, example: "abc123token"},
              password: {type: :string, example: "newpassword123@"},
              password_confirmation: {type: :string, example: "newpassword123@"}
            },
            required: ["reset_password_token", "password", "password_confirmation"]
          }
        },
        required: ["user"]
      }

      response "200", "Password reset successfully" do
        let!(:test_user) { create(:user, email: "user@example.com") }
        let(:reset_token) do
          raw, encrypted = Devise.token_generator.generate(User, :reset_password_token)
          test_user.update!(
            reset_password_token: encrypted,
            reset_password_sent_at: Time.current
          )
          raw
        end
        let(:user) do
          {
            "user" => {
              reset_password_token: reset_token,
              password: "newpassword123@",
              password_confirmation: "newpassword123@"
            }
          }
        end
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(response.parsed_body["message"]).to include("reset successfully")
        end
      end

      response "422", "Invalid request" do
        let(:user) do
          {
            "user" => {
              reset_password_token: "invalid_token",
              password: "newpassword123@",
              password_confirmation: "newpassword123@"
            }
          }
        end
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end
end
