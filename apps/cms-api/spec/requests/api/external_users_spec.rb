require "rails_helper"

RSpec.describe "External Users API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let!(:third_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user, other_user]) }
  let!(:other_hub) { create(:hub, users: [third_user]) }
  let!(:external_user_1) { create(:external_user, hub: hub, trusted_user: true, external_id: 1) }
  let!(:external_user_2) { create(:external_user, hub: hub, trusted_user: false, external_id: 2) }
  let!(:external_user_3) { create(:external_user, hub: hub, trusted_user: true, external_id: 3) }
  let!(:other_hub_external_user) { create(:external_user, hub: other_hub, trusted_user: true) }

  # user is the hub admin; other_user is an editor
  let(:other_headers) { auth_headers_for(other_user) }
  before { hub.hub_memberships.find_by(user: other_user).update!(role: :editor) }

  context "when listing external users" do
    it "returns all external users if user has access to hub" do
      get "/api/hubs/#{hub.id}/external-users", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(3)
      expect(json.map { |eu| eu["id"] }).to include(external_user_1.id, external_user_2.id, external_user_3.id)
    end

    it "returns only trusted external users when trusted param is true" do
      get "/api/hubs/#{hub.id}/external-users", headers: headers, params: {trusted: "true"}
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |eu| eu["id"] }).to include(external_user_1.id, external_user_3.id)
      expect(json.map { |eu| eu["id"] }).not_to include(external_user_2.id)
      expect(json.all? { |eu| eu["trusted_user"] == true }).to be(true)
    end

    it "returns external_id only for trusted external users" do
      get "/api/hubs/#{hub.id}/external-users", headers: other_headers
      expect(response).to have_http_status(:ok)
      external_ids = JSON.parse(response.body).to_h { |eu| [eu["id"], eu["external_id"]] }
      expect(external_ids).to include(external_user_1.id => "1", external_user_2.id => nil, external_user_3.id => "3")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/external-users", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent hub" do
      get "/api/hubs/999999/external-users", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "does not return external users from other hubs" do
      get "/api/hubs/#{hub.id}/external-users", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.map { |eu| eu["id"] }).not_to include(other_hub_external_user.id)
    end
  end
  context "when creating an external user" do
    let(:valid_params) { {external_user: {external_id: "ext-999", platform: "telegram", display_name: "Alice"}} }

    it "creates the external user with trusted_user true when user is hub admin" do
      expect {
        post "/api/hubs/#{hub.id}/external-users", headers: headers, params: valid_params
      }.to change(ExternalUser, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["trusted_user"]).to be(true)
    end

    it "forbids creation when user is a hub editor (not admin)" do
      post "/api/hubs/#{hub.id}/external-users", headers: other_headers, params: valid_params
      expect(response).to have_http_status(:forbidden)
    end

    it "returns not found if user is not a hub member" do
      non_member = create(:user, email: Faker::Internet.email)
      post "/api/hubs/#{hub.id}/external-users", headers: auth_headers_for(non_member), params: valid_params
      expect(response).to have_http_status(:not_found)
    end

    it "returns unprocessable_content when external_id is missing" do
      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: {external_user: {platform: "telegram"}}
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns unprocessable_content when platform is invalid" do
      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: {external_user: {external_id: "ext-999", platform: "internal"}}
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "updates trusted_user to true when external_id already exists for hub and platform" do
      external_user_1.update!(trusted_user: false)
      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: {external_user: {external_id: external_user_1.external_id, platform: external_user_1.platform}}
      expect(response).to have_http_status(:ok)
      expect(external_user_1.reload.trusted_user).to be(true)
    end

    it "creates without display_name" do
      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: {external_user: {external_id: "ext-no-name", platform: "whatsapp"}}
      expect(response).to have_http_status(:created)
    end

    it "promotes an end-user already known under the other Brazilian form, keeping WhatsApp's id" do
      known = create(:external_user, hub: hub, platform: "whatsapp", external_id: "551191234567", trusted_user: false)

      expect {
        post "/api/hubs/#{hub.id}/external-users", headers: headers, params: {external_user: {external_id: "5511991234567", platform: "whatsapp"}}
      }.not_to change(ExternalUser, :count)

      expect(response).to have_http_status(:ok)
      expect(known.reload).to have_attributes(trusted_user: true, external_id: "551191234567")
    end
  end

  context "when creating a Signal end-user by phone number" do
    let(:account_id) { "22222222-2222-4222-8222-222222222222" }
    let(:signal_service) { instance_double(SignalService) }
    let(:params) { {external_user: {external_id: "+15555550199", platform: "signal"}} }

    before do
      create(:signal_messaging_integration, hub: hub, active: true)
      allow(SignalService).to receive(:new).with("+15555550100").and_return(signal_service)
    end

    it "looks up their Signal account and trusts it" do
      allow(signal_service).to receive(:find_account_id).with("+15555550199").and_return(account_id)

      expect {
        post "/api/hubs/#{hub.id}/external-users", headers: headers, params: params
      }.to change(ExternalUser, :count).by(1)

      expect(response).to have_http_status(:created)
      expect(hub.external_users.find_by!(platform: "signal", external_id: account_id).trusted_user).to be(true)
    end

    it "trusts the end-user who already messaged the bot from that account" do
      known = create(:external_user, hub: hub, platform: "signal", external_id: account_id, trusted_user: false)
      allow(signal_service).to receive(:find_account_id).and_return(account_id)

      expect {
        post "/api/hubs/#{hub.id}/external-users", headers: headers, params: params
      }.not_to change(ExternalUser, :count)

      expect(known.reload.trusted_user).to be(true)
    end

    it "explains when the number has no findable Signal account" do
      allow(signal_service).to receive(:find_account_id).and_return(nil)

      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: params

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([I18n.t(:error_signal_user_not_found)])
    end

    it "explains when signal-cli can't be reached" do
      allow(signal_service).to receive(:find_account_id).and_raise(SignalService::Error, "connection refused")

      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: params

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([I18n.t(:error_signal_lookup_failed)])
    end

    it "requires Signal to be connected to the hub" do
      SignalMessagingIntegration.where(hub: hub).delete_all

      post "/api/hubs/#{hub.id}/external-users", headers: headers, params: params

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([I18n.t(:error_signal_not_connected)])
    end
  end

  context "when updating an external user" do
    let(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }

    it "promotes to trusted_user when user is a write super admin" do
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_2.id}", headers: auth_headers_for(write_admin), params: {external_user: {trusted_user: true}}
      expect(response).to have_http_status(:ok)
      expect(external_user_2.reload.trusted_user).to be(true)
    end

    it "forbids promotion to trusted_user when user is only a hub admin" do
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_2.id}", headers: headers, params: {external_user: {trusted_user: true}}
      expect(response).to have_http_status(:forbidden)
      expect(external_user_2.reload.trusted_user).to be(false)
    end

    it "forbids promotion when a hub admin sends a truthy value other than true" do
      ["1", "t", "on", "TRUE"].each do |truthy|
        patch "/api/hubs/#{hub.id}/external-users/#{external_user_2.id}", headers: headers, params: {external_user: {trusted_user: truthy}}
        expect(response).to have_http_status(:forbidden)
        expect(external_user_2.reload.trusted_user).to be(false)
      end
    end

    it "removes trusted_user when user is hub admin" do
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_1.id}", headers: headers, params: {external_user: {trusted_user: false}}
      expect(response).to have_http_status(:ok)
      expect(external_user_1.reload.trusted_user).to be(false)
    end

    it "forbids update when user is a hub editor (not admin)" do
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_1.id}", headers: other_headers, params: {external_user: {trusted_user: false}}
      expect(response).to have_http_status(:forbidden)
    end

    it "returns not found if user is not a hub member" do
      non_member = create(:user, email: Faker::Internet.email)
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_1.id}", headers: auth_headers_for(non_member), params: {external_user: {trusted_user: false}}
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for an external user not belonging to the hub" do
      patch "/api/hubs/#{hub.id}/external-users/#{other_hub_external_user.id}", headers: headers, params: {external_user: {trusted_user: false}}
      expect(response).to have_http_status(:not_found)
    end

    it "does not allow changing fields other than trusted_user" do
      original_external_id = external_user_1.external_id
      patch "/api/hubs/#{hub.id}/external-users/#{external_user_1.id}", headers: headers, params: {external_user: {trusted_user: false, external_id: "hacked"}}
      expect(external_user_1.reload.external_id).to eq(original_external_id)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "External Users API" do
  path "/api/hubs/{hub_id}/external-users" do
    get "Lists the external users of a hub" do
      tags "ExternalUser"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :trusted, in: :query, type: :string, required: false, description: "Filter by trusted users (true/false)"

      response "200", "Lists external users of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:external_user) { create(:external_user, hub: hub, trusted_user: true) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "200", "Lists only trusted external users when filtered" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:trusted_external_user) { create(:external_user, hub: hub, trusted_user: true, external_id: 1) }
        let!(:untrusted_external_user) { create(:external_user, hub: hub, trusted_user: false, external_id: 2) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:trusted) { "true" }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json.all? { |eu| eu["trusted_user"] == true }).to be(true)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Hub not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    post "Creates a trusted external user (hub admin only)" do
      tags "ExternalUser"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :external_user, in: :body, schema: {
        type: :object,
        properties: {
          external_id: {type: :string, description: "Platform-specific user identifier"},
          platform: {type: :string, enum: %w[telegram whatsapp signal], description: "Messaging platform. For signal, external_id is the end-user's phone number, which is looked up to their Signal account id"},
          display_name: {type: :string, description: "Optional display name"}
        },
        required: %w[external_id platform]
      }

      response "201", "External user created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:external_user) { {external_id: "ext-swagger-1", platform: "telegram", display_name: "Test User"} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "403", "Forbidden - not a hub admin" do
        let!(:admin) { create(:user) }
        let!(:editor) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [admin, editor]) }
        before { hub.hub_memberships.find_by(user: editor).update!(role: :editor) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(editor, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:external_user) { {external_id: "ext-swagger-2", platform: "telegram"} }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "422", "Unprocessable content" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:external_user) { {platform: "telegram"} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/external-users/{id}" do
    patch "Updates an external user's trusted_user field (hub admin only; promoting to trusted requires a write super admin)" do
      tags "ExternalUser"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :id, in: :path, type: :string, description: "External User ID"
      parameter name: :external_user, in: :body, schema: {
        type: :object,
        properties: {
          trusted_user: {type: :boolean, description: "Whether the user is trusted"}
        },
        required: %w[trusted_user]
      }

      response "200", "External user updated" do
        let!(:user) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:eu) { create(:external_user, hub: hub, trusted_user: false) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { eu.id }
        let(:external_user) { {trusted_user: true} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - not a hub admin" do
        let!(:admin) { create(:user) }
        let!(:editor) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [admin, editor]) }
        let!(:eu) { create(:external_user, hub: hub) }
        before { hub.hub_memberships.find_by(user: editor).update!(role: :editor) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(editor, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { eu.id }
        let(:external_user) { {trusted_user: false} }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end
    end
  end
end
