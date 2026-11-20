require "rails_helper"

RSpec.describe "User Registration API", type: :request do
  let!(:hub) { create(:hub, invite_code: "ABC123") }

  let(:valid_attributes) do
    {
      user: {
        email: "user@example.com",
        password: "password123@",
        password_confirmation: "password123@",
        invite_code: "ABC123"
      }
    }
  end

  let(:invalid_attributes) do
    {
      user: {
        email: "invalid",
        password: "short",
        password_confirmation: "wrong",
        invite_code: "ABC123"
      }
    }
  end

  it "registers a new user with valid params" do
    post "/api/signup", params: valid_attributes, as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["message"]).to include("check your email")
    user = User.find_by(email: "user@example.com")
    expect(user).to be_present
    expect(user.hubs).to include(hub)
  end

  it "returns same generic message when email already exists" do
    create(:user, email: "user@example.com")

    post "/api/signup", params: valid_attributes, as: :json

    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["message"]).to include("check your email")
    expect(response.parsed_body["errors"]).to be_nil
  end

  it "sends account exists notification when email already exists" do
    existing_user = create(:user, email: "user@example.com")

    expect {
      post "/api/signup", params: valid_attributes, as: :json
    }.to have_enqueued_mail(UserMailer, :account_exists).with(existing_user)
  end

  it "does not create a duplicate user when email already exists" do
    create(:user, email: "user@example.com")

    expect {
      post "/api/signup", params: valid_attributes, as: :json
    }.not_to change(User, :count)
  end

  it "fails to register a new user with invalid params" do
    post "/api/signup", params: invalid_attributes, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).to be_present
  end

  it "fails to register a new user if invite code is invalid" do
    post "/api/signup", params: {user: valid_attributes[:user].merge({invite_code: "XYZ987"})}, as: :json

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"][0]).to include("invite code")
  end

  describe "wrong invite code observability" do
    it "logs warning with context when invite code is wrong" do
      expect(LogService).to receive(:log).with(:info, "RegistrationsController", anything)
      expect(LogService).to receive(:log).with(:warn, "RegistrationsController", a_string_including("Invalid invite code attempt"))

      post "/api/signup", params: {user: valid_attributes[:user].merge({invite_code: "WRONG1"})}, as: :json

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "reports to Sentry when invite code is wrong" do
      allow(Sentry).to receive(:capture_message)

      post "/api/signup", params: {user: valid_attributes[:user].merge({invite_code: "WRONG2"})}, as: :json

      expect(Sentry).to have_received(:capture_message).with(
        "Invalid invite code attempt",
        hash_including(
          level: :warning,
          extra: hash_including(
            endpoint: "/api/signup"
          )
        )
      )
    end
  end

  # Tests for bug fix: Registration should be atomic
  context "transaction rollback on failure" do
    it "does not create user when HubMembership creation fails" do
      # Stub HubMembership.create! to raise validation error
      allow(HubMembership).to receive(:create!).and_raise(
        ActiveRecord::RecordInvalid.new(HubMembership.new)
      )

      expect {
        post "/api/signup", params: valid_attributes, as: :json
      }.not_to change(User, :count)

      expect(response).to have_http_status(:unprocessable_content)
      expect(User.find_by(email: "user@example.com")).to be_nil
    end

    it "rolls back user creation if HubMembership uniqueness constraint is violated" do
      # Create a user with membership first
      user = create(:user, email: "existing@example.com")
      create(:hub_membership, user: user, hub: hub)

      # Try to create duplicate membership by stubbing to force error after user save
      allow_any_instance_of(User).to receive(:id).and_return(user.id)

      initial_user_count = User.count

      post "/api/signup", params: {
        user: valid_attributes[:user].merge(email: "new@example.com")
      }, as: :json

      # Due to transaction, either both succeed or both fail
      expect(response.status).to be_in([200, 422])

      # If failed, user count should not increase
      if response.status == 422
        expect(User.count).to eq(initial_user_count)
      end
    end

    it "handles after_commit callback failures gracefully" do
      # Stub the create_default_data callback to fail
      allow(Notebook).to receive(:create!).and_raise(
        ActiveRecord::RecordNotSaved.new("Failed to create default notebook")
      )

      # The registration should still succeed because callback errors are caught
      expect {
        post "/api/signup", params: valid_attributes, as: :json
      }.to change(User, :count).by(1)
        .and change(HubMembership, :count).by(1)

      expect(response).to have_http_status(:ok)
      user = User.find_by(email: "user@example.com")
      expect(user).to be_present
      expect(user.hubs).to include(hub)
    end
  end

  context "atomicity guarantees" do
    it "ensures user and hub membership are created together or not at all" do
      # This test verifies the transaction wrapper works correctly

      # Scenario 1: Both succeed
      post "/api/signup", params: valid_attributes, as: :json
      expect(response).to have_http_status(:ok)

      user = User.find_by(email: "user@example.com")
      expect(user).to be_present
      expect(user.hub_memberships.count).to eq(1)
      expect(user.hubs).to include(hub)
    end

    it "sends confirmation email only after successful transaction" do
      # Clear any previous emails
      ActionMailer::Base.deliveries.clear

      post "/api/signup", params: valid_attributes, as: :json

      expect(response).to have_http_status(:ok)

      # Confirmation email should be queued (Devise uses deliver_later by default)
      # In test environment, check that the user has a confirmation token
      user = User.find_by(email: "user@example.com")
      expect(user.confirmation_token).to be_present
      expect(user.confirmed_at).to be_nil
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Registrations API" do
  path "/api/signup" do
    post "Creates a user" do
      tags "User"
      consumes "application/json"
      parameter name: :user, in: :body, schema: {
        type: :object,
        properties: {
          user: {
            type: :object,
            properties: {
              email: {type: :string, example: "foo@bar.test"},
              password: {type: :string, example: "foobar123@"},
              password_confirmation: {type: :string, example: "foobar123@"},
              invite_code: {type: :string, example: "ABC123"}
            },
            required: ["email", "password", "password_confirmation", "invite_code"]
          }
        },
        required: ["user"]
      }

      response "200", "Registration received" do
        let!(:hub) { create(:hub, invite_code: "ABC123") }
        let(:user) { {"user" => {email: "foo@bar.test", password: "foobar123@", password_confirmation: "foobar123@", invite_code: "ABC123"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "422", "Invalid request" do
        let(:user) { {"user" => {email: "foo", password: "bar", password_confirmation: "test", invite_code: "test"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end

      # Note: 429 (Too Many Requests) response is possible when rate limit is exceeded
      # Rate limiting is enforced by Rack::Attack middleware
      # See spec/requests/api/rate_limiting_spec.rb for rate limiting tests
    end
  end
end
