require "rails_helper"

RSpec.describe "Notebooks API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "NTBOOK", contribution_code: "#contrib1000") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "OTHER2", contribution_code: "#contrib2000") }

  let(:valid_attributes) do
    {
      notebook: {
        hub_id: hub.id,
        name: "My Notebook"
      }
    }
  end

  def with_picture(user)
    include("email" => user.email, "profile_picture_url" => be_present)
  end

  context "when getting a notebook" do
    let!(:notebook) { create(:notebook, hub: hub, user: user) }

    it "returns the notebook if user has access" do
      get "/api/notebooks/#{notebook.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq(notebook.id)
      expect(json["name"]).to eq(notebook.name)
      expect(json["user_id"]).to eq(user.id)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/notebooks/#{notebook.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if notebook doesn't exist" do
      get "/api/notebooks/0", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when creating a new notebook" do
    it "creates with valid parameters" do
      expect {
        post "/api/notebooks", params: valid_attributes, headers: headers
      }.to change(Notebook, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("My Notebook")
      expect(json["user_id"]).to eq(user.id)
    end

    it "returns validation errors if name is blank" do
      post "/api/notebooks", params: {notebook: {hub_id: hub.id, name: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      post "/api/notebooks", params: {
        notebook: {
          hub_id: other_hub.id,
          name: "External Hub Notebook"
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when updating an existing notebook" do
    let!(:notebook) { create(:notebook, hub: hub, user: user, name: "Old Name") }

    it "updates the notebook" do
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {name: "New Name", summary: "New Summary"}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("New Name")
      expect(json["summary_updated_by"]["name"]).to eq(user.name)
    end

    it "returns not found if user not in hub" do
      other_notebook = create(:notebook, hub: other_hub, user: other_user)
      patch "/api/notebooks/#{other_notebook.id}", params: {notebook: {name: "Bad Name"}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "can't update if name is blank" do
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {name: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "updates the priority_tier" do
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {priority_tier: 2}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["priority_tier"]).to eq(2)
      expect(notebook.reload.priority_tier).to eq(2)
    end

    it "updates the active status" do
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {active: false}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["active"]).to eq(false)
      expect(notebook.reload.active).to eq(false)
    end

    it "enqueues KnowledgeServiceWorker when active changes to false" do
      notebook.update(active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_notebook_summary", notebook.id, notebook.hub_id)
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {active: false}}, headers: headers
    end

    it "enqueues KnowledgeServiceWorker when active changes to true" do
      notebook.update(active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_notebook_summary", notebook.id)
      patch "/api/notebooks/#{notebook.id}", params: {notebook: {active: true}}, headers: headers
    end
  end

  context "when deleting a notebook" do
    it "deletes if user has access to hub" do
      notebook = create(:notebook, hub: hub, user: user)
      expect {
        delete "/api/notebooks/#{notebook.id}", headers: headers
      }.to change(Notebook, :count).by(-1)
      expect(response).to have_http_status(:ok)
      expect(Notebook.find_by_id(notebook.id)).to be(nil)
    end

    it "returns not found if hub does not exist or user cannot access it" do
      notebook = create(:notebook, hub: other_hub, user: other_user)
      expect {
        delete "/api/notebooks/#{notebook.id}", headers: headers
      }.to_not change(Notebook, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("Not found")
    end

    it "successfully deletes published notebook" do
      notebook = create(:notebook, hub: hub, user: user, published: true, summary: "Summary")
      expect {
        delete "/api/notebooks/#{notebook.id}", headers: headers
      }.to change(Notebook, :count).by(-1)
      expect(response).to have_http_status(:ok)
    end
  end

  context "when listing notebooks" do
    before { WebMock.disable_net_connect!(allow: [/silo/, /localhost/]) }

    let!(:third_user) { create(:user, :with_profile_picture, email: Faker::Internet.email) }
    let!(:fourth_user) { create(:user, :with_profile_picture, email: Faker::Internet.email) }
    let!(:third_user_membership) { create(:hub_membership, hub: hub, user: third_user) }
    let!(:fourth_user_membership) { create(:hub_membership, hub: hub, user: fourth_user) }
    let!(:notebook) { create(:notebook, hub: hub, user: user, name: "Notebook 1") }
    let!(:other_notebook) { create(:notebook, hub: hub, user: user, name: "Notebook 2") }
    let!(:another_notebook) { create(:notebook, hub: hub, user: third_user, name: "Notebook 3", published: true) }
    let!(:yet_another_notebook) { create(:notebook, hub: hub, user: fourth_user, name: "Notebook 4", published: true) }

    it "returns notebooks with summary editor information" do
      notebook.update!(summary: "Summary A", summary_updater: other_user)
      other_notebook.update!(summary: "Summary B", summary_updater: user)

      get "/api/hubs/#{hub.id}/notebooks", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["summary_updated_by"]&.dig("name") }).to include(other_user.name, user.name)
    end

    it "returns the profile picture of each summary editor" do
      notebook.update!(summary: "Summary A", summary_updater: third_user)
      other_notebook.update!(summary: "Summary B", summary_updater: fourth_user)

      get "/api/hubs/#{hub.id}/notebooks", headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"]).to include(
        include("name" => "Notebook 1", "summary_updated_by" => with_picture(third_user)),
        include("name" => "Notebook 2", "summary_updated_by" => with_picture(fourth_user))
      )
    end

    it "returns the profile picture of the owner" do
      owner = create(:user, :with_profile_picture, email: Faker::Internet.email)
      create(:hub_membership, hub: hub, user: owner)
      create(:notebook, hub: hub, user: owner, name: "Owner Notebook 1")
      create(:notebook, hub: hub, user: owner, name: "Owner Notebook 2")

      get "/api/hubs/#{hub.id}/notebooks", headers: auth_headers_for(owner)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"]).to include(
        include("name" => "Owner Notebook 1", "user" => with_picture(owner)),
        include("name" => "Owner Notebook 2", "user" => with_picture(owner))
      )
    end

    it "returns users notebooks if user has access to hub" do
      get "/api/hubs/#{hub.id}/notebooks", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].size).to eq(3)
      expect(json["data"].map { |d| d["name"] }).to include("My First Notebook", "Notebook 1", "Notebook 2")
      expect(json["pagination"]).to be_present
      expect(json["pagination"]["total_count"]).to eq(3)
    end

    it "returns published notebooks if user has access to hub" do
      get "/api/hubs/#{hub.id}/notebooks?published=true", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].size).to eq(2)
      expect(json["data"].map { |d| d["name"] }).to include("Notebook 3", "Notebook 4")
      expect(json["pagination"]).to be_present
      expect(json["pagination"]["total_count"]).to eq(2)
    end

    it "returns the count before filtering beside the filtered total" do
      yet_another_notebook.update!(active: false)
      get "/api/hubs/#{hub.id}/notebooks?published=true&status=active", headers: headers
      json = JSON.parse(response.body)
      expect(json["pagination"]["total_count"]).to eq(1)
      expect(json["pagination"]["unfiltered_count"]).to eq(2)
    end

    it "returns the profile pictures of owners and summary editors" do
      # update_columns: published notebooks reject summary edits
      another_notebook.update_columns(last_summary_updated_by_id: fourth_user.id)
      yet_another_notebook.update_columns(last_summary_updated_by_id: third_user.id)

      get "/api/hubs/#{hub.id}/notebooks?published=true", headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"]).to include(
        include("name" => "Notebook 3", "user" => with_picture(third_user), "summary_updated_by" => with_picture(fourth_user)),
        include("name" => "Notebook 4", "user" => with_picture(fourth_user), "summary_updated_by" => with_picture(third_user))
      )
    end

    it "hides published notebooks authored by non-members from regular members" do
      non_member = create(:user, email: Faker::Internet.email)
      create(:notebook, hub: hub, user: non_member, name: "Orphan Notebook", published: true)

      get "/api/hubs/#{hub.id}/notebooks?published=true", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["name"] }).not_to include("Orphan Notebook")
    end

    it "returns all published notebooks to super admins regardless of author membership" do
      super_admin = create(:user, email: "admin@meedan.com")
      create(:notebook, hub: hub, user: super_admin, name: "Admin Notebook", published: true)

      get "/api/hubs/#{hub.id}/notebooks?published=true", headers: auth_headers_for(super_admin)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["name"] }).to include("Notebook 3", "Notebook 4", "Admin Notebook")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/notebooks", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "supports filter and sort options" do
      get "/api/hubs/#{hub.id}/notebooks", params: {
        status: "active",
        date_modified: "last_7_days",
        notebooks: "true",
        published_by: user.id,
        date_published: "last_30_days",
        sync_status: "complete,pending",
        sort_by: "created_at",
        sort_direction: "desc"
      }, headers: headers
      expect(response).to have_http_status(:ok)

      # Test sync_status sorting
      get "/api/hubs/#{hub.id}/notebooks", params: {
        sort_by: "sync_status",
        sort_direction: "asc"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end
  end

  context "when sorting notebooks by the last editor" do
    def last_editors(direction)
      get "/api/hubs/#{hub.id}/notebooks", params: {sort_by: "last_summary_updated_by_id", sort_direction: direction}, headers: headers
      expect(response).to have_http_status(:ok)
      JSON.parse(response.body)["data"].map { |d| d["summary_updated_by"]&.dig("name") }
    end

    before do
      zed = create(:user, name: "Zed", email: "zed@example.com")
      amy = create(:user, name: "amy", email: "amy@example.com")
      no_name = create(:user, name: "", email: "Mia@example.com")
      [zed, amy, no_name, nil].each_with_index do |editor, index|
        create(:notebook, hub: hub, user: user, name: "Notebook #{index}", last_summary_updated_by: editor)
      end
    end

    it "orders by the editor's name, falling back to email, with no editor last" do
      editors = last_editors("asc")

      expect(editors.compact).to eq(["amy", "", "Zed"])
      expect(editors.last(editors.count(nil))).to all(be_nil)
    end

    it "keeps notebooks with no editor last when descending" do
      editors = last_editors("desc")

      expect(editors.compact).to eq(["Zed", "", "amy"])
      expect(editors.last(editors.count(nil))).to all(be_nil)
    end
  end

  context "when retrying sync" do
    let!(:notebook) { create(:notebook, hub: hub, user: user) }

    it "retries ingestion for error status notebook (active)" do
      notebook.update_columns(sync_status: :error, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_notebook_summary", notebook.id)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(notebook.reload.sync_status).to eq("pending")
    end

    it "retries deletion for error status notebook (inactive)" do
      notebook.update_columns(sync_status: :error, active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_notebook_summary", notebook.id, hub.id)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(notebook.reload.sync_status).to eq("pending")
    end

    it "retries for pending status notebook" do
      notebook.update_columns(sync_status: :pending, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_notebook_summary", notebook.id)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(notebook.reload.sync_status).to eq("pending")
    end

    it "returns error for complete status notebook" do
      notebook.update_column(:sync_status, :complete)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns error for error status notebook with a non-retryable error code" do
      notebook.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
      expect(KnowledgeServiceWorker).not_to receive(:perform_in)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns not found if user is not part of the hub" do
      notebook.update_column(:sync_status, :error)
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      post "/api/notebooks/#{notebook.id}/retry-sync", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if notebook doesn't exist" do
      post "/api/notebooks/0/retry-sync", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when regenerating ai summary" do
    let!(:notebook) { create(:notebook, hub: hub, user: user) }

    it "enqueues NotebookSummaryWorker and updates requested timestamp" do
      expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, kind_of(Float))
      post "/api/notebooks/#{notebook.id}/regenerate-ai-summary", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(notebook.reload.ai_summary_update_requested_at).to be_present
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      post "/api/notebooks/#{notebook.id}/regenerate-ai-summary", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if notebook doesn't exist" do
      post "/api/notebooks/0/regenerate-ai-summary", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when filtering by topics" do
    let!(:topic) { create(:topic, hub: hub, name: "Housing") }
    let!(:tagged) { create(:notebook, hub: hub, user: user, name: "Rents").tap { |item| create(:topic_item, topic: topic, item: item) } }
    let!(:untagged) { create(:notebook, hub: hub, user: user, name: "Untouched") }

    def names_for(params)
      get "/api/hubs/#{hub.id}/notebooks", params: params, headers: headers
      expect(response).to have_http_status(:ok)
      JSON.parse(response.body)["data"].map { |n| n["name"] }
    end

    it "returns the notebooks that have the topic, or all but them when excluding" do
      expect(names_for(topics: topic.id.to_s)).to eq(["Rents"])

      excluding = names_for(topics: topic.id.to_s, topics_mode: "exclude")
      expect(excluding).to include("Untouched")
      expect(excluding).not_to include("Rents")
    end

    it "returns the notebooks with no topics for none" do
      untagged_names = names_for(topics: "none")

      expect(untagged_names).to include("Untouched")
      expect(untagged_names).not_to include("Rents")
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Notebooks API" do
  path "/api/notebooks" do
    post "Creates a notebook" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :notebook, in: :body, schema: {
        type: :object,
        properties: {
          notebook: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              name: {type: :string, example: "My Notebook"}
            },
            required: ["hub_id", "name"]
          }
        },
        required: ["notebook"]
      }

      response "201", "Notebook created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook) { {"notebook" => {hub_id: hub.id, name: "My Notebook"}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:notebook) { {"notebook" => {name: "My Notebook"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create notebook" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook) { {"notebook" => {hub_id: hub.id, name: "My Notebook"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid notebook" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook) { {"notebook" => {hub_id: hub.id, name: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/notebooks/{id}" do
    get "Gets a notebook" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Notebook ID"

      response "200", "Notebook found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
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

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_notebook) { create(:notebook) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Notebook not found" do
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

    patch "Updates a notebook" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Notebook ID"
      parameter name: :notebook, in: :body, schema: {
        type: :object,
        properties: {
          notebook: {
            type: :object,
            properties: {
              id: {type: :integer, example: 1},
              name: {type: :string, example: "My Notebook"},
              summary: {type: :string, example: "The summary of my notebook."},
              published: {type: :boolean, example: true},
              active: {type: :boolean, example: true},
              priority_tier: {
                type: :integer,
                example: 1,
                description: "Priority tier: -1 (low, preloaded FAQ), 1 (default), 2 (high)"
              }
            },
            required: ["id"]
          }
        },
        required: ["notebook"]
      }

      response "200", "Notebook updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
        let(:notebook) { {"notebook" => {name: "The Notebook", summary: "The summary"}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:notebook) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_notebook) { create(:notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
        let(:notebook) { {"notebook" => {name: "The Notebook"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Notebook not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:notebook) { {"notebook" => {name: "The Notebook"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid notebook" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
        let(:notebook) { {"notebook" => {name: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    delete "Deletes a notebook" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Notebook ID"

      response "200", "Notebook deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
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

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_notebook) { create(:notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Notebook not found" do
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

  path "/api/hubs/{hub_id}/notebooks" do
    get "Lists the notebooks of a hub" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :published, in: :query, type: :boolean, description: "Show only published notebooks"
      parameter name: :topics, in: :query, type: :string, required: false, description: "Topic ids, separated by commas, and \"none\" for the items with no topics. Shows the items that have any of them, or all but those with topics_mode exclude"
      parameter name: :topics_mode, in: :query, type: :string, required: false, enum: %w[include exclude], description: "Whether the topics filter shows the matching items (the default) or all but them"

      response "200", "Lists of notebooks of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:published) { false }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        let(:published) { false }
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
        let(:published) { false }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/notebooks/{id}/retry-sync" do
    post "Retries sync for a notebook" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Notebook ID"

      response "202", "Sync retry queued" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) do
          nb = create(:notebook, hub: hub, user: user)
          nb.update_column(:sync_status, :error)
          nb
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let!(:notebook) do
          nb = create(:notebook, hub: hub)
          nb.update_column(:sync_status, :error)
          nb
        end
        let(:Authorization) { nil }
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:notebook) do
          nb = create(:notebook, hub: hub)
          nb.update_column(:sync_status, :error)
          nb
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Notebook not found" do
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

      response "422", "Notebook not in retryable state" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) do
          nb = create(:notebook, hub: hub, user: user)
          nb.update_column(:sync_status, :complete)
          nb
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/notebooks/{id}/regenerate-ai-summary" do
    post "Triggers notebook AI summary regeneration" do
      tags "Notebook"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Notebook ID"

      response "202", "Notebook AI summary generation acknowledged" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let!(:notebook) { create(:notebook, hub: hub) }
        let(:Authorization) { nil }
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:notebook) { create(:notebook, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Notebook not found" do
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
end
