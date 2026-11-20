require "rails_helper"

RSpec.describe "Notes API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "NTBOOK") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "OTHER2") }
  let!(:notebook) { create(:notebook, hub: hub, user: user) }
  let!(:other_notebook) { create(:notebook, hub: other_hub, user: other_user) }

  let(:valid_attributes) do
    {
      note: {
        notebook_id: notebook.id,
        title: "My Note",
        content: "This is my note."
      }
    }
  end

  context "when creating a new note" do
    it "creates with valid parameters" do
      expect {
        post "/api/notes", params: valid_attributes, headers: headers
      }.to change(Note, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["title"]).to eq("My Note")
      expect(json["user_id"]).to eq(user.id)
    end

    it "returns validation errors if fields are blank" do
      post "/api/notes", params: {note: {notebook_id: notebook.id, title: "", content: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      post "/api/notes", params: {
        note: {
          notebook_id: other_notebook.id,
          title: "External Hub Note",
          content: "External Hub Note"
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when updating an existing note" do
    let!(:note) { create(:note, notebook: notebook, user: user, title: "Old Title") }

    it "updates the note" do
      patch "/api/notes/#{note.id}", params: {note: {title: "New Title"}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["title"]).to eq("New Title")
    end

    it "returns not found if user not in hub" do
      other_note = create(:note, notebook: other_notebook, user: other_user)
      patch "/api/notes/#{other_note.id}", params: {note: {title: "Bad Title"}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "can't update if fields are blank" do
      patch "/api/notes/#{note.id}", params: {note: {title: "", content: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when deleting a note" do
    it "deletes if user has access to hub" do
      note = create(:note, notebook: notebook, user: user)
      expect {
        delete "/api/notes/#{note.id}", headers: headers
      }.to change(Note, :count).by(-1)
      expect(response).to have_http_status(:ok)
      expect(Note.find_by_id(note.id)).to be(nil)
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      note = create(:note, notebook: other_notebook, user: other_user)
      expect {
        delete "/api/notes/#{note.id}", headers: headers
      }.to_not change(Note, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when listing notes" do
    let!(:note) { create(:note, notebook: notebook, user: user, title: "Note 1") }
    let!(:other_note) { create(:note, notebook: notebook, user: user, title: "Note 2") }

    it "returns notes if user has access to hub" do
      get "/api/notebooks/#{notebook.id}/notes", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |d| d["title"] }).to include("Note 1", "Note 2")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/notebooks/#{notebook.id}/notes", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Notes API" do
  path "/api/notes" do
    post "Creates a note" do
      tags "Note"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :note, in: :body, schema: {
        type: :object,
        properties: {
          note: {
            type: :object,
            properties: {
              notebook_id: {type: :integer, example: 1},
              title: {type: :string, example: "My Note"},
              content: {type: :string, example: "This is my note."}
            },
            required: ["notebook_id", "title", "content"]
          }
        },
        required: ["note"]
      }

      response "201", "Note created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:note) { {"note" => {notebook_id: notebook.id, title: "My Note", content: "This is my note."}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:note) { {"note" => {title: "My Note"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create note" do
        let!(:user) { create(:user) }
        let!(:notebook) { create(:notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:note) { {"note" => {notebook_id: notebook.id, title: "My Note", content: "This is my note."}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid note" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:note) { {"note" => {notebook_id: notebook.id, name: "", content: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/notes/{id}" do
    patch "Updates a note" do
      tags "Note"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Note ID"
      parameter name: :note, in: :body, schema: {
        type: :object,
        properties: {
          note: {
            type: :object,
            properties: {
              id: {type: :integer, example: 1},
              title: {type: :string, example: "My Note"},
              content: {type: :string, example: "This is my note."}
            },
            required: ["id"]
          }
        },
        required: ["note"]
      }

      response "200", "Note updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let!(:existing_note) { create(:note, notebook: notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_note.id }
        let(:note) { {"note" => {title: "The Note", content: "This is the note."}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:note) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to update note" do
        let!(:user) { create(:user) }
        let!(:notebook) { create(:notebook, user: user) }
        let!(:existing_note) { create(:note, notebook: notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_note.id }
        let(:note) { {"note" => {title: "The Note"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Note not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:note) { {"note" => {title: "The Note"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid note" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let!(:existing_note) { create(:note, notebook: notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_note.id }
        let(:note) { {"note" => {title: "", content: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    delete "Deletes a note" do
      tags "Note"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Note ID"

      response "200", "Note deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let!(:existing_note) { create(:note, notebook: notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_note.id }
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

      response "404", "Not found - no permission to delete note" do
        let!(:user) { create(:user) }
        let!(:notebook) { create(:notebook, user: user) }
        let!(:existing_note) { create(:note, notebook: notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_note.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Note not found" do
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

  path "/api/notebooks/{notebook_id}/notes" do
    get "Lists the notes of a notebook" do
      tags "Note"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :notebook_id, in: :path, type: :string, description: "Notebook ID"

      response "200", "Lists of notes of a notebook" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:notebook_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:notebook) { create(:notebook, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
