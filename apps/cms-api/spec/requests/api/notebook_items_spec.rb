require "rails_helper"

RSpec.describe "Notebook items API", type: :request do
  let!(:user) { create(:user) }
  let(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "NBITEM", contribution_code: "#contrib1000") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "OTHERH", contribution_code: "#contrib2000") }
  let!(:notebook) { create(:notebook, hub: hub, user: user) }
  let!(:other_notebook) { create(:notebook, hub: other_hub, user: other_user) }
  let!(:conversation) { create(:conversation, hub: hub, participant: create(:hub_membership, hub: hub).user) }
  let!(:other_conversation) { create(:conversation, hub: other_hub, participant: other_user) }
  let!(:contribution) { create(:contribution, hub: hub) }
  let!(:message) { create(:message, :outgoing, conversation: conversation) }
  let!(:document) { create(:document, source: create(:source, hub: hub)) }
  let!(:other_message) { create(:message, :outgoing, conversation: other_conversation) }
  let!(:message_cluster) { create(:message_cluster, hub: hub) }

  context "when listing notebook items for a notebook" do
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: message) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: notebook, item: conversation) }

    it "returns notebook items if user has access to hub" do
      get "/api/notebooks/#{notebook.id}/items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
    end

    context "when a conversation is soft-deleted" do
      def soft_deleted_conversation
        create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email))
      end

      def soft_delete(deleted_conversation)
        deleted_conversation.update!(deleted_at: Time.current)
      end

      def listed_items
        get "/api/notebooks/#{notebook.id}/items", headers: headers
        JSON.parse(response.body).map { |item| [item["item_type"], item["item_id"]] }
      end

      it "does not list the conversation" do
        deleted = soft_deleted_conversation
        create(:notebook_item, notebook: notebook, item: deleted)
        soft_delete(deleted)

        expect(listed_items).not_to include(["Conversation", deleted.id])
      end

      it "does not list its messages" do
        deleted = soft_deleted_conversation
        deleted_message = create(:message, :incoming, conversation: deleted)
        create(:notebook_item, notebook: notebook, item: deleted_message)
        soft_delete(deleted)

        expect(listed_items).not_to include(["Message", deleted_message.id])
      end

      it "does not list a cluster whose messages are all in soft-deleted conversations" do
        deleted = soft_deleted_conversation
        orphan_cluster = create(:message_cluster, hub: hub)
        create(:message, :incoming, conversation: deleted, message_cluster: orphan_cluster)
        create(:notebook_item, notebook: notebook, item: orphan_cluster)
        soft_delete(deleted)

        expect(listed_items).not_to include(["MessageCluster", orphan_cluster.id])
      end

      it "still lists a cluster that has a message in a live conversation" do
        deleted = soft_deleted_conversation
        mixed_cluster = create(:message_cluster, hub: hub)
        create(:message, :incoming, conversation: conversation, message_cluster: mixed_cluster)
        create(:message, :incoming, conversation: deleted, message_cluster: mixed_cluster)
        create(:notebook_item, notebook: notebook, item: mixed_cluster)
        soft_delete(deleted)

        expect(listed_items).to include(["MessageCluster", mixed_cluster.id])
      end

      it "still lists items that do not belong to a conversation" do
        create(:notebook_item, notebook: notebook, item: document)
        soft_delete(soft_deleted_conversation)

        expect(listed_items).to include(["Document", document.id])
      end
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/notebooks/#{notebook.id}/items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/notebooks/#{other_notebook.id}/items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when listing notebooks where a notebook is used as an item" do
    let!(:parent_notebook) { create(:notebook, hub: hub, user: user) }
    let!(:another_parent_notebook) { create(:notebook, hub: hub, user: user) }
    let!(:notebook_item) { create(:notebook_item, notebook: parent_notebook, item: notebook) }
    let!(:another_notebook_item) { create(:notebook_item, notebook: another_parent_notebook, item: notebook) }

    it "returns notebook items if user has access to hub" do
      get "/api/notebooks/#{notebook.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/notebooks/#{notebook.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/notebooks/#{other_notebook.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when listing notebook items for a document" do
    let!(:other_document) { create(:document, source: create(:source, hub: other_hub)) }
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: document) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: other_notebook, item: other_document) }

    it "returns notebook items if user has access to hub" do
      get "/api/documents/#{document.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/documents/#{document.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/documents/#{other_document.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when listing notebook items for a conversation" do
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: conversation) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: other_notebook, item: other_conversation) }

    it "returns notebook items if user has access to hub" do
      get "/api/conversations/#{conversation.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/conversations/#{conversation.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/conversations/#{other_conversation.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for a conversation hidden from the list" do
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user))
      create(:notebook_item, notebook: notebook, item: hidden_conversation)
      get "/api/conversations/#{hidden_conversation.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns notebook items of a conversation hidden from the list to super admins" do
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user))
      hidden_notebook_item = create(:notebook_item, notebook: notebook, item: hidden_conversation)
      get "/api/conversations/#{hidden_conversation.id}/notebook-items", headers: auth_headers_for(create(:user, email: "admin@meedan.com"))
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.map { |item| item["id"] }).to eq([hidden_notebook_item.id])
    end
  end

  context "when listing notebook items for a message" do
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: message) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: other_notebook, item: other_message) }

    it "returns notebook items if user has access to hub" do
      get "/api/messages/#{message.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/messages/#{message.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/messages/#{other_message.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for a message of a conversation hidden from the list" do
      hidden_message = create(:message, :outgoing, conversation: create(:conversation, hub: hub, participant: create(:user)))
      create(:notebook_item, notebook: notebook, item: hidden_message)
      get "/api/messages/#{hidden_message.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns notebook items of a message of a conversation hidden from the list to super admins" do
      hidden_message = create(:message, :outgoing, conversation: create(:conversation, hub: hub, participant: create(:user)))
      hidden_notebook_item = create(:notebook_item, notebook: notebook, item: hidden_message)
      get "/api/messages/#{hidden_message.id}/notebook-items", headers: auth_headers_for(create(:user, email: "admin@meedan.com"))
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.map { |item| item["id"] }).to eq([hidden_notebook_item.id])
    end
  end

  context "when listing notebook items for a contribution" do
    let!(:other_contribution) { create(:contribution, hub: other_hub) }
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: contribution) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: other_notebook, item: other_contribution) }

    it "returns notebook items if user has access to hub" do
      get "/api/contributions/#{contribution.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/contributions/#{contribution.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/contributions/#{other_contribution.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when listing notebook items for a message_cluster" do
    let!(:other_message_cluster) { create(:message_cluster, hub: other_hub) }
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: message_cluster) }
    let!(:other_notebook_item) { create(:notebook_item, notebook: other_notebook, item: other_message_cluster) }

    it "returns notebook items if user has access to hub" do
      get "/api/message-clusters/#{message_cluster.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(1)
    end

    it "includes cluster fields when listed in a notebook" do
      create(:message, :outgoing, conversation: conversation, reply_to: create(:message, :incoming, conversation: conversation, message_cluster: message_cluster, external_id: SecureRandom.hex, body: "test body"), answered: true)
      create(:message, :outgoing, conversation: other_conversation, reply_to: create(:message, :incoming, conversation: other_conversation, message_cluster: other_message_cluster, external_id: SecureRandom.hex))

      get "/api/notebooks/#{notebook.id}/items", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      cluster_item = json.find { |i| i["item_type"] == "MessageCluster" && i["item_id"] == message_cluster.id }
      expect(cluster_item["item"]["last_message_body"]).to eq("test body")
      expect(cluster_item["item"]["last_message_answered_status"]).to eq(true)
      expect(cluster_item["item"]["current_answered_status_count"]).to eq(1)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/message-clusters/#{message_cluster.id}/notebook-items", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      get "/api/message-clusters/#{other_message_cluster.id}/notebook-items", headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when creating a new notebook item" do
    it "creates with valid parameters for Message" do
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Message",
          item_id: message.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("Message")
      expect(json["item_id"]).to eq(message.id)
      expect(notebook.reload.ai_summary_update_requested_at).to be_present
    end

    it "creates with valid parameters for MessageCluster" do
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "MessageCluster",
          item_id: message_cluster.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("MessageCluster")
      expect(json["item_id"]).to eq(message_cluster.id)
    end

    it "creates with valid parameters for Conversation" do
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Conversation",
          item_id: conversation.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("Conversation")
      expect(json["item_id"]).to eq(conversation.id)
    end

    it "creates with valid parameters for Document" do
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Document",
          item_id: document.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("Document")
      expect(json["item_id"]).to eq(document.id)
    end

    it "creates with valid parameters for Contribution" do
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Contribution",
          item_id: contribution.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("Contribution")
      expect(json["item_id"]).to eq(contribution.id)
    end

    it "creates with valid parameters for Notebook" do
      child_notebook = create(:notebook, hub: hub, user: user, name: "Child Notebook")
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Notebook",
          item_id: child_notebook.id
        }, headers: headers
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_type"]).to eq("Notebook")
      expect(json["item_id"]).to eq(child_notebook.id)
    end

    it "rejects adding a notebook to itself" do
      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "Notebook",
        item_id: notebook.id
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to include(I18n.t(:error_notebook_cannot_contain_itself))
    end

    it "returns not found if user can't access notebook hub" do
      post "/api/notebooks/#{other_notebook.id}/items", params: {
        item_type: "Message",
        item_id: message.id
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if user can't access item hub" do
      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "Message",
        item_id: other_message.id
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for a conversation hidden from the list" do
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user))
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Conversation",
          item_id: hidden_conversation.id
        }, headers: headers
      }.not_to change(NotebookItem, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found for a message of a conversation hidden from the list" do
      hidden_message = create(:message, :outgoing, conversation: create(:conversation, hub: hub, participant: create(:user)))
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Message",
          item_id: hidden_message.id
        }, headers: headers
      }.not_to change(NotebookItem, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "creates for a conversation hidden from the list when the user is a super admin" do
      super_admin = create(:user, email: "admin@meedan.com", admin_write_access: true)
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user))
      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Conversation",
          item_id: hidden_conversation.id
        }, headers: auth_headers_for(super_admin)
      }.to change(NotebookItem, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["item_id"]).to eq(hidden_conversation.id)
    end

    it "rejects an item from another hub even when the user is a member of both" do
      create(:hub_membership, user: user, hub: other_hub, approved: true)

      expect {
        post "/api/notebooks/#{notebook.id}/items", params: {
          item_type: "Message",
          item_id: other_message.id
        }, headers: headers
      }.not_to change(NotebookItem, :count)
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to include(I18n.t(:error_notebook_item_different_hub))
    end

    it "returns unprocessable entity for invalid item type" do
      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "InvalidType",
        item_id: message.id
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("Invalid item type")
    end

    it "returns bad request for missing item_type" do
      post "/api/notebooks/#{notebook.id}/items", params: {
        item_id: message.id
      }, headers: headers
      expect(response).to have_http_status(:bad_request)
    end

    it "returns bad request for missing item_id" do
      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "Message"
      }, headers: headers
      expect(response).to have_http_status(:bad_request)
    end

    it "returns validation errors if notebook item fails to save" do
      # Create a duplicate notebook item first
      create(:notebook_item, notebook: notebook, item: message)

      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "Message",
        item_id: message.id
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns unprocessable entity when notebook has reached max items" do
      ENV["MAX_NOTEBOOK_ITEMS"] = "2"
      create_list(:notebook_item, 2, notebook: notebook)
      new_message = create(:message, :outgoing, conversation: conversation)

      post "/api/notebooks/#{notebook.id}/items", params: {
        item_type: "Message",
        item_id: new_message.id
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    ensure
      ENV.delete("MAX_NOTEBOOK_ITEMS")
    end
  end

  context "when deleting a notebook item" do
    let!(:notebook_item) { create(:notebook_item, notebook: notebook, item: message) }

    it "deletes if user has access to hub" do
      expect {
        delete "/api/notebooks/#{notebook.id}/items/#{notebook_item.id}", headers: headers
      }.to change(NotebookItem, :count).by(-1)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to eq("Deleted successfully")
      expect(NotebookItem.find_by_id(notebook_item.id)).to be(nil)
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      other_notebook_item = create(:notebook_item, notebook: other_notebook, item: other_message)
      expect {
        delete "/api/notebooks/#{other_notebook.id}/items/#{other_notebook_item.id}", headers: headers
      }.to_not change(NotebookItem, :count)
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns not found if notebook item doesn't exist" do
      delete "/api/notebooks/#{notebook.id}/items/9999", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Notebook Items API" do
  path "/api/notebooks/{notebook_id}/items" do
    get "Lists the items of a notebook" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :notebook_id, in: :path, type: :string, description: "Notebook ID"

      response "200", "Lists of items of a notebook" do
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

    post "Creates a notebook item" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :notebook_id, in: :path, type: :string, description: "Notebook ID"
      parameter name: :notebook_item, in: :body, schema: {
        type: :object,
        properties: {
          item_type: {type: :string, example: "Message", enum: ["Message", "Conversation", "Document", "Contribution", "MessageCluster", "Notebook"]},
          item_id: {type: :integer, example: 1}
        },
        required: ["item_type", "item_id"]
      }

      response "201", "NotebookItem created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let!(:message) { create(:message, :outgoing, conversation: conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:notebook_item) { {item_type: "Message", item_id: message.id} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:notebook_id) { 1 }
        let(:notebook_item) { {item_type: "Message", item_id: 1} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create notebook item" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, user: user) }
        let!(:conversation) { create(:conversation, hub: hub) }
        let!(:message) { create(:message, :outgoing, conversation: conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:notebook_item) { {item_type: "Message", item_id: message.id} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid notebook item" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:notebook_item) { {item_type: "InvalidType", item_id: 1} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/notebooks/{notebook_id}/items/{id}" do
    delete "Deletes a notebook item" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :notebook_id, in: :path, type: :string, description: "Notebook ID"
      parameter name: :id, in: :path, type: :string, description: "NotebookItem ID"

      response "200", "NotebookItem deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let!(:conversation) { create(:conversation, hub: hub) }
        let!(:message) { create(:message, :outgoing, conversation: conversation) }
        let!(:existing_notebook_item) { create(:notebook_item, notebook: notebook, item: message) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:id) { existing_notebook_item.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:notebook_id) { 1 }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to delete notebook item" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, user: user) }
        let!(:conversation) { create(:conversation, hub: notebook.hub) }
        let!(:message) { create(:message, :outgoing, conversation: conversation) }
        let!(:existing_notebook_item) { create(:notebook_item, notebook: notebook, item: message) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:id) { existing_notebook_item.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "NotebookItem not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:notebook_id) { notebook.id }
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/documents/{document_id}/notebook-items" do
    get "Lists the notebook items of a document" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :document_id, in: :path, type: :string, description: "Document ID"

      response "200", "Lists of notebook items of a document" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:document_id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:document_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:document) { create(:document) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:document_id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/conversations/{conversation_id}/notebook-items" do
    get "Lists the notebook items of a conversation" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :conversation_id, in: :path, type: :string, description: "Conversation ID"

      response "200", "Lists of notebook items of a conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation_id) { conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:conversation_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:conversation) { create(:conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation_id) { conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/messages/{message_id}/notebook-items" do
    get "Lists the notebook items of a message" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :message_id, in: :path, type: :string, description: "Message ID"

      response "200", "Lists of notebook items of a message" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let!(:message) { create(:message, :outgoing, conversation: conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:message_id) { message.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:message_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:message) { create(:message, :outgoing) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:message_id) { message.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/contributions/{contribution_id}/notebook-items" do
    get "Lists the notebook items of a contribution" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :contribution_id, in: :path, type: :string, description: "Contribution ID"

      response "200", "Lists of notebook items of a contribution" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:contribution_id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:contribution_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:contribution) { create(:contribution) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:contribution_id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/notebooks/{item_notebook_id}/notebook-items" do
    get "Lists the notebooks where a notebook is used as an item" do
      tags "NotebookItem"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :item_notebook_id, in: :path, type: :string, description: "Notebook ID"

      response "200", "List of notebooks where the notebook is used as an item" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:notebook) { create(:notebook, hub: hub, user: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:item_notebook_id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:item_notebook_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:notebook) { create(:notebook) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:item_notebook_id) { notebook.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
