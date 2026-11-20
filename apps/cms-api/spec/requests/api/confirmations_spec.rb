require "rails_helper"

RSpec.describe "User Confirmation API", type: :request do
  let(:user) { create(:user, confirmed_at: nil) }

  it "confirms a user by token" do
    raw_token, enc_token = Devise.token_generator.generate(User, :confirmation_token)
    user.update(confirmation_token: enc_token, confirmation_sent_at: Time.current)

    post "/api/confirmation", params: {confirmation_token: raw_token}, as: :json, headers: {"Host" => "test.host"}

    expect(response).to have_http_status(200)
    expect(JSON.parse(response.body)["success"]).to eq(true)
    expect(JSON.parse(response.body)["email"]).to eq(user.email)
    expect(user.reload.confirmed_at).not_to be_nil
  end

  it "returns error with invalid token" do
    post "/api/confirmation", params: {confirmation_token: "invalid-token"}, as: :json, headers: {"Host" => "test.host"}

    expect(response).to have_http_status(422)
    expect(JSON.parse(response.body)["success"]).to eq(false)
  end

  it "does not confirm user with GET request" do
    raw_token, enc_token = Devise.token_generator.generate(User, :confirmation_token)
    user.update(confirmation_token: enc_token, confirmation_sent_at: Time.current)

    get "/api/confirmation?confirmation_token=#{raw_token}", as: :json, headers: {"Host" => "test.host"}

    # GET requests should redirect to frontend (Devise default behavior)
    expect(response).to have_http_status(302)
    # User should NOT be confirmed by GET request
    expect(user.reload.confirmed_at).to be_nil
  end

  it "escapes the token so it cannot inject extra query parameters" do
    get "/api/confirmation?confirmation_token=#{CGI.escape("abc&email=attacker@example.com")}", as: :json, headers: {"Host" => "test.host"}

    query = URI.decode_www_form(URI.parse(response.location).query)
    expect(query.map(&:first)).to eq(["confirmation_token"])
  end

  it "does not confirm user with HEAD request" do
    raw_token, enc_token = Devise.token_generator.generate(User, :confirmation_token)
    user.update(confirmation_token: enc_token, confirmation_sent_at: Time.current)

    head "/api/confirmation?confirmation_token=#{raw_token}", headers: {"Host" => "test.host"}

    # HEAD requests should return 200 without processing
    expect(response).to have_http_status(200)
    # User should NOT be confirmed by HEAD request
    expect(user.reload.confirmed_at).to be_nil
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Confirmations API" do
  path "/api/confirmation" do
    post "Confirms a user" do
      tags "User"
      consumes "application/json"
      produces "application/json"
      parameter name: :confirmation_token, in: :query, type: :string, required: true

      response "200", "User account confirmed successfully" do
        let!(:user) { create(:user, confirmed_at: nil) }
        let(:confirmation_token) do
          raw, enc = Devise.token_generator.generate(User, :confirmation_token)
          user.update!(confirmation_token: enc, confirmation_sent_at: Time.current)
          raw
        end
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(200)
          expect(JSON.parse(response.body)["success"]).to eq(true)
          expect(JSON.parse(response.body)["email"]).to eq(user.email)
        end
      end

      response "422", "Invalid confirmation token" do
        let!(:user) { create(:user, confirmed_at: nil) }
        let(:confirmation_token) { "invalid-token" }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(422)
          expect(JSON.parse(response.body)["success"]).to eq(false)
        end
      end
    end
  end
end
