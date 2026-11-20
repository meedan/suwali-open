require "rails_helper"
require "swagger_helper"

RSpec.describe "Message Reports API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user]) }
  let!(:conversation) { create(:conversation, hub: hub, participant: user) }
  let!(:message) { create(:message, conversation: conversation, direction: "outgoing") }

  context "when creating a new message report" do
    it "creates with valid parameters" do
      expect {
        post "/api/messages/#{message.id}/reports",
          params: {message_report: {comment: "Spam or inappropriate content"}},
          headers: headers
      }.to change(MessageReport, :count).by(1)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["message_id"]).to eq(message.id)
      expect(json["comment"]).to eq("Spam or inappropriate content")
    end

    it "fails to save with invalid message type" do
      # Create an incoming message (not outgoing/bot message)
      incoming_message = create(:message, conversation: conversation, direction: "incoming")

      expect {
        post "/api/messages/#{incoming_message.id}/reports",
          params: {message_report: {comment: "Spam or inappropriate content"}},
          headers: headers
      }.not_to change(MessageReport, :count)

      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to be_present
      expect(json["errors"]).to be_an(Array)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

describe "Message Reports API" do
  path "/api/messages/{message_id}/reports" do
    parameter name: :message_id, in: :path, type: :integer, required: true,
      description: "Message ID of the message being reported"

    post "Creates a message report" do
      tags "MessageReport"
      consumes "application/json"
      produces "application/json"
      security [bearerAuth: []]

      parameter name: :message_report, in: :body, schema: {
        type: :object,
        properties: {
          message_report: {
            type: :object,
            description: "Send only `comment`. `reported_by` is taken from the authenticated user.",
            properties: {
              comment: {type: :string, example: "Spam or inappropriate content"}
            },
            required: ["comment"]
          }
        },
        required: ["message_report"],
        example: {
          message_report: {comment: "Spam or inappropriate content"}
        }
      }

      response "201", "Message report created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let!(:message) { create(:message, conversation: conversation, direction: "outgoing") }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:message_id) { message.id }
        let(:message_report) { {message_report: {comment: "Spam or inappropriate content"}} }

        run_test!
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:message_id) { 1 }
        let(:message_report) { {message_report: {comment: "Any"}} }

        run_test!
      end

      response "404", "No permission to create message report" do
        let!(:user) { create(:user) }
        let!(:other_user) { create(:user) }
        let!(:other_hub) { create(:hub, users: [other_user]) }
        let!(:conversation) { create(:conversation, hub: other_hub, participant: other_user) }
        let!(:message) { create(:message, conversation: conversation, direction: "outgoing") }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:message_id) { message.id }
        let(:message_report) { {message_report: {comment: "Spam"}} }

        run_test!
      end

      response "404", "Message not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }

        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end

        let(:message_id) { 0 }
        let(:message_report) { {message_report: {comment: "x"}} }

        run_test!
      end
    end
  end
end
