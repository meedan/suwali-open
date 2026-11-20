require "rails_helper"

RSpec.describe "User Resends API", type: :request do
  let(:Authorization) { nil }
  let(:unconfirmed_user) { create(:user, confirmed_at: nil) }
  let!(:confirmed_user) { create(:user, confirmed_at: Time.current) }

  describe "POST /api/resends" do
    it "sends confirmation instructions for a valid, unconfirmed email" do
      expect {
        post "/api/resends", params: {user: {email: unconfirmed_user.email}}, as: :json
      }.to change { ActionMailer::Base.deliveries.count }.by(2)

      expect(response).to have_http_status(200)
      expect(JSON.parse(response.body)["success"]).to eq(true)
    end

    it "returns success response for a non-existent email" do
      post "/api/resends", params: {user: {email: "nonexistent@example.com"}}, as: :json
      expect(response).to have_http_status(200)
      expect(JSON.parse(response.body)["success"]).to eq(true)
    end

    it "returns success response for already confirmed email" do
      post "/api/resends", params: {user: {email: confirmed_user.email}}, as: :json
      expect(response).to have_http_status(200)
      expect(JSON.parse(response.body)["success"]).to eq(true)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Resends API" do
  path "/api/resends" do
    post "Resends confirmation instructions" do
      tags "User"
      consumes "application/json"
      produces "application/json"

      parameter name: :email, in: :body, type: :string, required: true

      response "200", "Confirmation instructions sent successfully" do
        let!(:user_record) { create(:user, confirmed_at: nil) }
        let(:email) { {user: {email: user_record.email}} }
        let(:Authorization) { nil }

        run_test! do |response|
          expect(response).to have_http_status(200)
          expect(JSON.parse(response.body)["success"]).to eq(true)
        end
      end

      response "200", "Email does not exist" do
        let(:email) { {user: {email: "emailtest@example.com"}} }
        let(:Authorization) { nil }

        run_test! do |response|
          expect(response).to have_http_status(200)
        end
      end
    end
  end
end
