require "rails_helper"

RSpec.describe "Message Clusters API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user]) }
  let!(:cluster) { create(:message_cluster, hub: hub) }
  let!(:conversation) { create(:conversation, :external, hub: hub) }
  let!(:incoming_message) { create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex) }
  before { cluster.update!(centroid_message: incoming_message) }
  let!(:bot_reply) { create(:message, :outgoing, conversation: conversation, reply_to: incoming_message, answered: true) }

  describe "GET /api/message-clusters/:id/messages" do
    context "when authenticated as a hub member" do
      it "returns 200 with the cluster messages" do
        get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["data"]).to be_an(Array)
        expect(json["data"].length).to eq(1)
      end

      it "includes id, body, created_at, particpant, trusted_user status and reply in each message" do
        get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

        json = JSON.parse(response.body)
        message_data = json["data"].first

        participant = incoming_message.conversation.participant
        expect(message_data["id"]).to eq(incoming_message.id)
        expect(message_data).to have_key("created_at")
        expect(message_data["body"]).to eq(incoming_message.body)
        expect(message_data["reply"]["id"]).to eq(bot_reply.id)
        expect(message_data["reply"]["body"]).to eq(bot_reply.body)
        expect(message_data["conversation"]).to eq({
          "id" => conversation.id,
          "platform" => conversation.platform,
          "participant_id" => conversation.participant_id,
          "participant" => {
            "type" => conversation.participant_type,
            "name" => participant.effective_display_name,
            "trusted_user" => participant.trusted_user
          }
        })
        expect(json).to have_key("pagination")
      end

      it "excludes messages with no external_id" do
        internal_message = create(:message, :incoming, conversation: conversation, message_cluster: cluster)
        create(:message, :outgoing, conversation: conversation, reply_to: internal_message, answered: true)

        get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

        json = JSON.parse(response.body)
        ids = json["data"].map { |m| m["id"] }
        expect(ids).not_to include(internal_message.id)
        expect(json).to have_key("pagination")
      end

      it "excludes messages in soft-deleted conversations" do
        deleted = create(:conversation, :external, hub: hub)
        ask_clustered_question(deleted, cluster, answered: true)
        deleted.update!(deleted_at: Time.current)

        get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

        ids = JSON.parse(response.body)["data"].map { |message| message["id"] }
        expect(ids).to eq([incoming_message.id])
      end

      it "excludes messages that have no bot reply" do
        message_without_reply = create(:message, :incoming, conversation: conversation, message_cluster: cluster)

        get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

        json = JSON.parse(response.body)
        ids = json["data"].map { |m| m["id"] }
        expect(ids).not_to include(message_without_reply.id)
        expect(json).to have_key("pagination")
      end

      context "when filtering by answered" do
        let!(:answered_message) { create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex) }
        let!(:non_answered_message) { create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex) }
        before do
          create(:message, :outgoing, conversation: conversation, reply_to: answered_message, answered: true)
          create(:message, :outgoing, conversation: conversation, reply_to: non_answered_message, answered: false)
        end

        it "returns only messages whose bot reply is answered when answered=true" do
          get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "true"}

          json = JSON.parse(response.body)
          ids = json["data"].map { |m| m["id"] }
          expect(ids).to include(answered_message.id)
          expect(ids).not_to include(non_answered_message.id)
        end

        it "returns only messages whose bot reply is non-answered when answered=false" do
          get "/api/message-clusters/#{cluster.id}/messages", headers: headers, params: {answered: "false"}

          json = JSON.parse(response.body)
          ids = json["data"].map { |m| m["id"] }
          expect(ids).to include(non_answered_message.id)
          expect(ids).not_to include(answered_message.id)
        end
      end
    end

    context "when unauthenticated" do
      it "returns 401" do
        get "/api/message-clusters/#{cluster.id}/messages"

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "when not a hub member" do
      let!(:other_user) { create(:user) }

      it "returns 404" do
        get "/api/message-clusters/#{cluster.id}/messages", headers: auth_headers_for(other_user)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when the cluster does not exist" do
      it "returns 404" do
        get "/api/message-clusters/0/messages", headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "MessageClusters API" do
  path "/api/message-clusters/{id}/messages" do
    get "Returns a cluster's messages and their bot reply" do
      tags "MessageCluster"
      consumes "application/json"
      produces "application/json"
      security [bearerAuth: []]

      parameter name: :id, in: :path, type: :string, description: "Message Cluster ID"
      parameter name: :answered, in: :query, type: :string, required: false, description: "Answered/Unanswered questions"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Items per page"

      response "200", "Message Cluster's messages" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:cluster) { create(:message_cluster, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { cluster.id }
        let(:page) { 1 }
        let(:per_page) { 1 }

        run_test!
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }

        run_test!
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:other_hub) { create(:hub) }
        let!(:cluster) { create(:message_cluster, hub: other_hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { cluster.id }

        run_test!
      end

      response "404", "Cluster not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 999999 }

        run_test!
      end
    end
  end
end
