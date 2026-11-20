require "rails_helper"

RSpec.describe "ExternalResources API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "EXTRES") }
  let!(:other_hub) { create(:hub, invite_code: "OTHER2") }

  let(:valid_attributes) do
    {
      external_resource: {
        hub_id: hub.id,
        title: "https://example.com/start",
        resource_type: "link",
        scenarios: ["role_description", "error_occurred"],
        description: "For getting started questions"
      }
    }
  end

  context "when creating a new external resource" do
    it "creates with valid parameters" do
      expect {
        post "/api/external-resources", params: valid_attributes, headers: headers
      }.to change(ExternalResource, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["scenarios"]).to eq(["role_description", "error_occurred"])
      expect(json["title"]).to eq("https://example.com/start")
      expect(json["resource_type"]).to eq("link")
      expect(json["description"]).to eq("For getting started questions")
    end

    it "refuses a title that does not fit its type" do
      post "/api/external-resources", params: {external_resource: {hub_id: hub.id, resource_type: "link", title: "not a link", scenarios: ["role_description"]}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_resource_link_invalid))
    end

    it "returns validation errors if scenarios is empty" do
      post "/api/external-resources", params: {external_resource: {hub_id: hub.id, scenarios: [], title: "Test"}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns validation errors if scenarios contains invalid values" do
      post "/api/external-resources", params: {external_resource: {hub_id: hub.id, scenarios: ["role_description", "invalid_value"], title: "Test"}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
      expect(json["errors"][0]).to include("Invalid")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      post "/api/external-resources", params: {
        external_resource: {
          hub_id: other_hub.id,
          title: "Forbidden Resource",
          scenarios: ["role_description"]
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "forbids creation when user is an editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      post "/api/external-resources", params: valid_attributes, headers: headers
      expect(response).to have_http_status(:forbidden)
    end
  end

  context "when updating an existing resource" do
    let!(:external_resource) { create(:external_resource, hub: hub, scenarios: ["role_description"]) }

    it "updates the external resource" do
      patch "/api/external-resources/#{external_resource.id}", params: {external_resource: {scenarios: ["unanswerable_question", "error_occurred"]}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["scenarios"]).to eq(["unanswerable_question", "error_occurred"])
    end

    it "ignores attempts to change the resource type" do
      link = create(:external_resource, hub: hub, resource_type: "link", title: "https://example.com")
      patch "/api/external-resources/#{link.id}", params: {external_resource: {resource_type: "question"}}, headers: headers
      expect(response).to have_http_status(:ok)
      expect(link.reload.resource_type).to eq("link")
    end

    it "returns not found if user not in hub" do
      other_resource = create(:external_resource)
      patch "/api/external-resources/#{other_resource.id}", params: {external_resource: {scenarios: ["role_description"]}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "can't update if scenarios is empty" do
      patch "/api/external-resources/#{external_resource.id}", params: {external_resource: {scenarios: []}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "forbids update when user is an editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      patch "/api/external-resources/#{external_resource.id}", params: {external_resource: {scenarios: ["unanswerable_question"]}}, headers: headers
      expect(response).to have_http_status(:forbidden)
    end
  end

  context "when deleting a resource" do
    it "deletes if user has access to hub" do
      external_resource = create(:external_resource, hub: hub)
      expect {
        delete "/api/external-resources/#{external_resource.id}", headers: headers
      }.to change(ExternalResource, :count).by(-1)
      expect(response).to have_http_status(:ok)
      expect(ExternalResource.find_by_id(external_resource.id)).to be(nil)
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      external_resource = create(:external_resource)
      expect {
        delete "/api/external-resources/#{external_resource.id}", headers: headers
      }.to_not change(ExternalResource, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "forbids deletion when user is an editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      external_resource = create(:external_resource, hub: hub)
      expect {
        delete "/api/external-resources/#{external_resource.id}", headers: headers
      }.to_not change(ExternalResource, :count)
      expect(response).to have_http_status(:forbidden)
    end
  end

  context "when listing resources" do
    let!(:resource1) { create(:external_resource, hub: hub, title: "Resource 1") }
    let!(:resource2) { create(:external_resource, hub: hub, title: "Resource 2") }

    it "returns external resources if user has access to hub" do
      get "/api/hubs/#{hub.id}/external-resources", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |d| d["title"] }).to include("Resource 1", "Resource 2")
    end

    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      get "/api/hubs/#{hub.id}/external-resources", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "ExternalResources API" do
  path "/api/external-resources" do
    post "Creates an external resource" do
      tags "ExternalResource"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :external_resource, in: :body, schema: {
        type: :object,
        properties: {
          external_resource: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              title: {type: :string, example: "https://example.com/start"},
              resource_type: {type: :string, enum: ExternalResource::RESOURCE_TYPES, example: "link"},
              scenarios: {type: :array, items: {type: :string, enum: %w[role_description unanswerable_question error_occurred]}, example: ["role_description", "error_occurred"]},
              description: {type: :string, example: "For getting started questions"}
            },
            required: ["hub_id", "title", "scenarios"]
          }
        },
        required: ["external_resource"]
      }

      response "201", "Resource created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:external_resource) { {"external_resource" => {hub_id: hub.id, title: "Getting Started Guide", scenarios: ["role_description"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:external_resource) { {"external_resource" => {title: "Test", scenarios: ["role_description"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create resource" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:external_resource) { {"external_resource" => {hub_id: hub.id, title: "Test", scenarios: ["role_description"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid resource" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:external_resource) { {"external_resource" => {hub_id: hub.id, title: "Test", scenarios: []}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/external-resources/{id}" do
    patch "Updates a resource" do
      tags "ExternalResource"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "External Resource ID"
      parameter name: :external_resource, in: :body, schema: {
        type: :object,
        properties: {
          external_resource: {
            type: :object,
            properties: {
              title: {type: :string, example: "Updated Guide"},
              scenarios: {type: :array, items: {type: :string, enum: %w[role_description unanswerable_question error_occurred]}, example: ["unanswerable_question"]},
              description: {type: :string, example: "Updated description"}
            }
          }
        },
        required: ["external_resource"]
      }

      response "200", "Resource updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_external_resource) { create(:external_resource, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_external_resource.id }
        let(:external_resource) { {"external_resource" => {scenarios: ["unanswerable_question", "error_occurred"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:external_resource) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to update resource" do
        let!(:user) { create(:user) }
        let!(:existing_external_resource) { create(:external_resource) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_external_resource.id }
        let(:external_resource) { {"external_resource" => {scenarios: ["role_description"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Resource not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:external_resource) { {"external_resource" => {scenarios: ["role_description"]}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid resource" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_external_resource) { create(:external_resource, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_external_resource.id }
        let(:external_resource) { {"external_resource" => {scenarios: []}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    delete "Deletes a resource" do
      tags "ExternalResource"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Resource ID"

      response "200", "Resource deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_external_resource) { create(:external_resource, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_external_resource.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to delete resource" do
        let!(:user) { create(:user) }
        let!(:existing_external_resource) { create(:external_resource) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_external_resource.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Resource not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/external-resources" do
    get "Lists the external resources of a hub" do
      tags "ExternalResource"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists of external resources of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
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
        let(:hub_id) { 0 }
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
    end
  end
end
