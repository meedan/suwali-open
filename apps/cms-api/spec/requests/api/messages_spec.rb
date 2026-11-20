require "rails_helper"

RSpec.describe "Messages API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "MSGMSG") }
  let!(:conversation) { create(:conversation, hub: hub, participant: user) }
  let!(:other_conversation) { create(:conversation, hub: hub, participant: other_user) }

  let(:valid_attributes) do
    {
      message: {
        conversation_id: conversation.id,
        body: "This is my message."
      }
    }
  end

  context "when creating a new message" do
    it "creates with valid parameters" do
      expect {
        post "/api/messages", params: valid_attributes, headers: headers
      }.to change(Message, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["body"]).to eq("This is my message.")
      expect(json["conversation_id"]).to eq(conversation.id)
      expect(json["direction"]).to eq("incoming")
    end

    it "returns validation errors if fields are blank" do
      post "/api/messages", params: {message: {conversation_id: conversation.id, body: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns forbidden if user can't access conversation" do
      create(:hub_membership, hub: hub, user: other_user)
      post "/api/messages", params: {
        message: {
          conversation_id: other_conversation.id,
          body: "External Conversation Message"
        }
      }, headers: headers
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
    end

    it "returns not found for a conversation hidden from the list" do
      post "/api/messages", params: {
        message: {
          conversation_id: other_conversation.id,
          body: "Hidden Conversation Message"
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when the conversation is deleted" do
    let!(:message) { create(:message, :outgoing, conversation: conversation) }

    before { conversation.update!(deleted_at: Time.current) }

    it "returns not found when listing messages" do
      get "/api/conversations/#{conversation.id}/messages", headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found and creates nothing when posting a message" do
      expect { post "/api/messages", params: valid_attributes, headers: headers }.not_to change(Message, :count)

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for a message callback" do
      post "/api/messages/#{message.id}/callback", params: {callback: {id: "see_sources_123", type: "sources"}}, headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end

  context "when listing messages" do
    let!(:message) { create(:message, :outgoing, conversation: conversation, body: "Message 1") }
    let!(:other_message) { create(:message, :outgoing, conversation: conversation, body: "Message 2") }
    let!(:other_participant_message) { create(:message, :outgoing, conversation: other_conversation, body: "Message 3") }

    it "returns latest messages if user has access to conversation" do
      get "/api/conversations/#{conversation.id}/messages", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)["data"]
      expect(json.size).to eq(2)
      expect(json.map { |d| d["body"] }).to include("Message 1", "Message 2")
    end

    it "does not cause an N+1 for outgoing messages with MDSI" do
      document = create(:document, title: "Original Title")
      document2 = create(:document, title: "Original Title2")
      create(:message_data_source_item, message: message, item: document, hub: hub)
      create(:message_data_source_item, message: message, item: document2, hub: hub)

      expect {
        get "/api/conversations/#{conversation.id}/messages", headers: headers
      }.not_to exceed_query_limit(13)
    end

    it "returns messages around a message if user has access to conversation" do
      get "/api/conversations/#{conversation.id}/messages?around_id=#{other_message.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)["data"]
      expect(json.size).to eq(2)
      expect(json.map { |d| d["body"] }).to include("Message 1", "Message 2")
    end

    it "returns the window around the oldest message when anchored to the last record" do
      message.update!(created_at: 2.days.ago)
      get "/api/conversations/#{conversation.id}/messages?sort_by=created_at&sort_direction=desc&anchor=last", headers: headers
      expect(response).to have_http_status(:ok)
      pagination = JSON.parse(response.body)["pagination"]
      expect(pagination["target_record_id"]).to eq(message.id)
      expect(pagination["has_next"]).to be(false)
    end

    it "returns the window around the newest message by default" do
      message.update!(created_at: 2.days.ago)
      get "/api/conversations/#{conversation.id}/messages?sort_by=created_at&sort_direction=desc&window_size=20", headers: headers
      expect(response).to have_http_status(:ok)
      pagination = JSON.parse(response.body)["pagination"]
      expect(pagination["target_record_id"]).to eq(other_message.id)
      expect(pagination["has_previous"]).to be(false)
    end

    it "returns not found if user is not part of the conversation" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/conversations/#{conversation.id}/messages", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found to regular members for a conversation hidden from the list" do
      get "/api/conversations/#{other_conversation.id}/messages", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns messages of another member's conversation" do
      create(:hub_membership, hub: hub, user: other_user)
      get "/api/conversations/#{other_conversation.id}/messages", headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"].map { |d| d["body"] }).to eq(["Message 3"])
    end

    it "returns messages of a conversation hidden from the list to super admins" do
      super_admin = create(:user, email: "super@meedan.com")
      get "/api/conversations/#{other_conversation.id}/messages", headers: auth_headers_for(super_admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"].map { |d| d["body"] }).to eq(["Message 3"])
    end
  end

  context "when interacting with message callbacks" do
    let!(:message) { create(:message, :outgoing, conversation: conversation) }
    let!(:other_message) { create(:message, :outgoing, conversation: other_conversation) }

    let(:callback_params) do
      {
        callback: {
          id: "see_sources_123",
          type: "sources"
        }
      }
    end

    it "processes a valid callback" do
      post "/api/messages/#{message.id}/callback",
        params: callback_params,
        headers: headers

      expect(response).to have_http_status(:ok)
    end

    it "returns bad request when callback payload is invalid" do
      post "/api/messages/#{message.id}/callback",
        params: {
          callback: {
            id: "",
            type: ""
          }
        },
        headers: headers

      expect(response).to have_http_status(:bad_request)
    end

    it "returns forbidden when the user cannot access the message conversation" do
      create(:hub_membership, hub: hub, user: other_user)
      post "/api/messages/#{other_message.id}/callback",
        params: callback_params,
        headers: headers

      expect(response).to have_http_status(:forbidden)

      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
    end

    it "returns not found when the message conversation is hidden from the list" do
      post "/api/messages/#{other_message.id}/callback",
        params: callback_params,
        headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found when the message does not exist" do
      post "/api/messages/999999/callback",
        params: callback_params,
        headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Messages API" do
  path "/api/messages" do
    post "Creates a message" do
      tags "Message"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :message, in: :body, schema: {
        type: :object,
        properties: {
          message: {
            type: :object,
            properties: {
              conversation_id: {type: :integer, example: 1},
              body: {type: :string, example: "This is my message."}
            },
            required: ["conversation_id", "body"]
          }
        },
        required: ["message"]
      }

      response "201", "Message created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:message) { {"message" => {conversation_id: conversation.id, body: "This is my message."}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:message) { {"message" => {body: "My Message"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:message) { {"message" => {conversation_id: conversation.id, body: "This is my message."}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid message" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:message) { {"message" => {conversation_id: conversation.id, body: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/conversations/{conversation_id}/messages" do
    get "Lists the messages of a conversation" do
      tags "Message"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :conversation_id, in: :path, type: :string, description: "Conversation ID"
      parameter name: :around_id, in: :query, type: :string, description: "Message ID (get messages around it)"
      parameter name: :anchor, in: :query, type: :string, required: false, enum: ["first", "last"], description: "Without around_id, start from the first (default) or last message in sort order"

      response "200", "Lists of messages of a conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation_id) { conversation.id }
        let(:around_id) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:conversation_id) { 0 }
        let(:around_id) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email)) }
        let(:around_id) { nil }
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

  path "/api/messages/{id}/callback" do
    post "Processes a message callback" do
      tags "Message"
      consumes "application/json"
      security [bearerAuth: []]

      parameter name: :id, in: :path, type: :integer, description: "Message ID"

      parameter name: :callback, in: :body, schema: {
        type: :object,
        properties: {
          callback: {
            type: :object,
            properties: {
              id: {type: :string, example: "see_sources_123"},
              type: {type: :string, example: "sources"}
            },
            required: ["id", "type"]
          }
        },
        required: ["callback"]
      }

      response "200", "Callback processed" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let!(:message_record) { create(:message, :outgoing, conversation: conversation) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:id) { message_record.id }

        let(:callback) do
          {
            callback: {
              id: "see_sources_123",
              type: "sources"
            }
          }
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "400", "Invalid callback payload" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let!(:message_record) { create(:message, :outgoing, conversation: conversation) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:id) { message_record.id }

        let(:callback) do
          {
            callback: {
              id: "",
              type: ""
            }
          }
        end

        run_test! do |response|
          expect(response).to have_http_status(:bad_request)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }

        let(:callback) do
          {
            callback: {
              id: "see_sources_123",
              type: "sources"
            }
          }
        end

        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "Forbidden" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user, email: Faker::Internet.email) }
        let!(:hub) { create(:hub, users: [user, other_user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: other_user) }
        let!(:message_record) { create(:message, :outgoing, conversation: conversation) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:id) { message_record.id }

        let(:callback) do
          {
            callback: {
              id: "see_sources_123",
              type: "sources"
            }
          }
        end

        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "Message not found" do
        let!(:user) { create(:user) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:id) { 999999 }

        let(:callback) do
          {
            callback: {
              id: "see_sources_123",
              type: "sources"
            }
          }
        end

        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
