require "rails_helper"

RSpec.describe "Hub Memberships API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let!(:third_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user, other_user], invite_code: "HUBMEM") }
  let!(:other_hub) { create(:hub, users: [third_user], invite_code: "OTHRHB") }

  context "when requesting to join a hub" do
    let(:domain) { user.email.split("@").last }
    let!(:admin_user) { create(:user, email: "admin@#{domain}") }
    let!(:joinable_hub) { create(:hub, users: [admin_user]) }

    it "creates a pending membership and returns 201" do
      expect {
        post "/api/hubs/#{joinable_hub.id}/memberships", headers: headers
      }.to change(HubMembership, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["hub_id"]).to eq(joinable_hub.id)
      expect(json["user_id"]).to eq(user.id)
      expect(json["role"]).to eq("editor")
      expect(json["approved"]).to eq(false)
    end

    it "returns 422 when the hub is not in the user's joinable hubs" do
      post "/api/hubs/#{other_hub.id}/memberships", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns 422 when the user is already a member of the hub" do
      HubMembership.create!(user: user, hub: joinable_hub, role: :editor, approved: false)
      post "/api/hubs/#{joinable_hub.id}/memberships", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns 422 when membership fails to save (e.g. race condition)" do
      allow_any_instance_of(HubMembership).to receive(:save).and_return(false)
      post "/api/hubs/#{joinable_hub.id}/memberships", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns 404 when the hub does not exist" do
      post "/api/hubs/999999/memberships", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns 401 when unauthenticated" do
      post "/api/hubs/#{joinable_hub.id}/memberships"
      expect(response).to have_http_status(:unauthorized)
    end
  end

  context "when listing hub memberships" do
    it "returns memberships if user has access to hub" do
      get "/api/hubs/#{hub.id}/memberships", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |m| m["user"]["id"] }).to include(user.id, other_user.id)
    end

    # Activity timestamps are only ever shown back to the user they belong to,
    # so they must not ride along in the serialisation hub members share.
    it "does not expose other members' activity timestamps" do
      get "/api/hubs/#{hub.id}/memberships", headers: headers

      users = JSON.parse(response.body).map { |m| m["user"] }
      expect(users).to all(include("email"))
      expect(users.flat_map(&:keys).uniq).not_to include("last_login_at", "last_active_at")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/memberships", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent hub" do
      get "/api/hubs/999999/memberships", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when updating a hub membership" do
    let!(:membership_to_update) { hub.hub_memberships.find_by(user: other_user) }

    before do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
    end

    it "updates membership role when user is admin" do
      membership_to_update.update!(role: :editor)
      patch "/api/hubs/#{hub.id}/memberships/#{membership_to_update.id}",
        params: {hub_membership: {role: :admin}},
        headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["role"]).to eq("admin")
      expect(membership_to_update.reload.role).to eq("admin")
    end

    it "forbids update when user is editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      membership_to_update.update!(role: :editor)
      patch "/api/hubs/#{hub.id}/memberships/#{membership_to_update.id}",
        params: {hub_membership: {role: :admin}},
        headers: headers
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
      expect(membership_to_update.reload.role).to eq("editor")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      patch "/api/hubs/#{hub.id}/memberships/#{membership_to_update.id}",
        params: {hub_membership: {role: :admin}},
        headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent hub" do
      patch "/api/hubs/999999/memberships/#{membership_to_update.id}",
        params: {hub_membership: {role: :admin}},
        headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for non-existent membership" do
      patch "/api/hubs/#{hub.id}/memberships/999999",
        params: {hub_membership: {role: :admin}},
        headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "doesn't update membership from different hub" do
      other_membership = other_hub.hub_memberships.first
      patch "/api/hubs/#{hub.id}/memberships/#{other_membership.id}",
        params: {hub_membership: {role: :admin}},
        headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns validation errors for invalid role" do
      patch "/api/hubs/#{hub.id}/memberships/#{membership_to_update.id}",
        params: {hub_membership: {role: "invalid_role"}},
        headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when updating membership approval status" do
    let!(:pending_membership) { create(:hub_membership, hub: hub, approved: false) }

    before do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
    end

    it "allows admin to approve membership" do
      patch "/api/hubs/#{hub.id}/memberships/#{pending_membership.id}",
        params: {hub_membership: {approved: true}},
        headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["approved"]).to be true
      expect(pending_membership.reload.approved).to be true
    end

    it "forbids non-admin from approving" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      patch "/api/hubs/#{hub.id}/memberships/#{pending_membership.id}",
        params: {hub_membership: {approved: true}},
        headers: headers

      expect(response).to have_http_status(:forbidden)
      expect(pending_membership.reload.approved).to be false
    end

    it "allows admin to un-approve membership" do
      approved_membership = create(:hub_membership, hub: hub, approved: true)
      patch "/api/hubs/#{hub.id}/memberships/#{approved_membership.id}",
        params: {hub_membership: {approved: false}},
        headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["approved"]).to be false
      expect(approved_membership.reload.approved).to be false
    end

    it "allows admin to approve and change role in same request" do
      patch "/api/hubs/#{hub.id}/memberships/#{pending_membership.id}",
        params: {hub_membership: {approved: true, role: :admin}},
        headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["approved"]).to be true
      expect(json["role"]).to eq("admin")
      expect(pending_membership.reload.approved).to be true
      expect(pending_membership.reload.role).to eq("admin")
    end
  end

  context "when deleting a hub membership" do
    let!(:membership_to_delete) { hub.hub_memberships.find_by(user: other_user) }

    before do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
    end

    it "deletes membership if user is admin" do
      expect {
        delete "/api/hubs/#{hub.id}/memberships/#{membership_to_delete.id}", headers: headers
      }.to change(HubMembership, :count).by(-1)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to eq("Deleted successfully")
      expect(HubMembership.find_by_id(membership_to_delete.id)).to be(nil)
    end

    it "forbids deletion when user is editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      expect {
        delete "/api/hubs/#{hub.id}/memberships/#{membership_to_delete.id}", headers: headers
      }.to_not change(HubMembership, :count)
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      expect {
        delete "/api/hubs/#{hub.id}/memberships/#{membership_to_delete.id}", headers: other_headers
      }.to_not change(HubMembership, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for non-existent hub" do
      delete "/api/hubs/999999/memberships/#{membership_to_delete.id}", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns ok even if membership doesn't exist" do
      # This follows the controller logic where it tries to find and destroy
      delete "/api/hubs/#{hub.id}/memberships/999999", headers: headers
      expect(response).to have_http_status(:not_found)
      JSON.parse(response.body)
    end

    it "doesn't delete membership from different hub" do
      other_membership = other_hub.hub_memberships.first
      expect {
        delete "/api/hubs/#{hub.id}/memberships/#{other_membership.id}", headers: headers
      }.to_not change(HubMembership, :count)
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when leaving a hub" do
    it "deletes the current user's approved membership and returns 200" do
      expect {
        delete "/api/hubs/#{hub.id}/memberships/leave", headers: headers
      }.to change(HubMembership, :count).by(-1)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to eq("Deleted successfully")
      expect(hub.hub_memberships.find_by(user: user)).to be_nil
    end

    it "deletes the current user's pending (unapproved) membership and returns 200" do
      hub.hub_memberships.find_by(user: user).update!(approved: false)
      expect {
        delete "/api/hubs/#{hub.id}/memberships/leave", headers: headers
      }.to change(HubMembership, :count).by(-1)
      expect(response).to have_http_status(:ok)
      expect(hub.hub_memberships.find_by(user: user)).to be_nil
    end

    it "returns 404 when the user has no membership in the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      delete "/api/hubs/#{hub.id}/memberships/leave", headers: auth_headers_for(another_user)
      expect(response).to have_http_status(:not_found)
    end

    it "returns 404 when the hub does not exist" do
      delete "/api/hubs/999999/memberships/leave", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns 401 when unauthenticated" do
      delete "/api/hubs/#{hub.id}/memberships/leave"
      expect(response).to have_http_status(:unauthorized)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Hub Memberships API" do
  path "/api/hubs/{hub_id}/memberships" do
    post "Request to join a hub (creates a pending membership)" do
      tags "HubMembership"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "201", "Membership request created" do
        let!(:user) { create(:user, email: "requester@customdomain.example") }
        let!(:admin_user) { create(:user, email: "admin@customdomain.example") }
        let!(:joinable_hub) { create(:hub, users: [admin_user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { joinable_hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:created)
          json = JSON.parse(response.body)
          expect(json["approved"]).to eq(false)
          expect(json["role"]).to eq("editor")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
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

      response "422", "Hub not joinable or user is already a member" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    get "Lists the memberships of a hub" do
      tags "HubMembership"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists memberships of a hub" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
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
  end

  path "/api/hubs/{hub_id}/memberships/{id}" do
    patch "Updates a hub membership" do
      tags "HubMembership"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :id, in: :path, type: :string, description: "HubMembership ID"
      parameter name: :hub_membership, in: :body, schema: {
        type: :object,
        properties: {
          hub_membership: {
            type: :object,
            properties: {
              role: {type: :string, enum: ["admin", "editor"], example: "admin"},
              approved: {type: :boolean, example: true}
            }
          }
        },
        required: ["hub_membership"]
      }

      response "200", "HubMembership updated" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let!(:membership) { hub.hub_memberships.find_by(user: other_user) }
        let(:Authorization) do
          user_membership = hub.hub_memberships.find_by(user: user)
          user_membership.update!(role: :admin)
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { membership.id }
        let(:hub_membership) { {hub_membership: {role: "admin"}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 1 }
        let(:id) { 1 }
        let(:hub_membership) { {hub_membership: {role: "admin"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "No permission to update hub membership" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let!(:membership) { hub.hub_memberships.find_by(user: other_user) }
        let(:Authorization) do
          user_membership = hub.hub_memberships.find_by(user: user)
          user_membership.update!(role: :editor)
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { membership.id }
        let(:hub_membership) { {hub_membership: {role: "admin"}} }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "Hub not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { 999999 }
        let(:id) { 1 }
        let(:hub_membership) { {hub_membership: {role: "admin"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    delete "Deletes a hub membership" do
      tags "HubMembership"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :id, in: :path, type: :string, description: "HubMembership ID"

      response "200", "HubMembership deleted" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let!(:membership) { hub.hub_memberships.find_by(user: other_user) }
        let(:Authorization) do
          user_membership = hub.hub_memberships.find_by(user: user)
          user_membership.update!(role: :admin)
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { membership.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 1 }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "No permission to delete hub membership" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let!(:membership) { hub.hub_memberships.find_by(user: other_user) }
        let(:Authorization) do
          user_membership = hub.hub_memberships.find_by(user: user)
          user_membership.update!(role: :editor)
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { membership.id }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "Hub not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { 999999 }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/memberships/leave" do
    delete "Leave a hub (removes the current user's own membership)" do
      tags "HubMembership"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Successfully left the hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json["message"]).to eq("Deleted successfully")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Hub not found or user is not a member" do
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
    end
  end
end
