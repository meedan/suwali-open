require "rails_helper"

RSpec.describe "Hubs API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, plan: :free, users: [user], invite_code: "HUBTST", name: "Test Hub") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "OTHERHUB", name: "Other Hub") }

  context "when showing a hub" do
    it "returns hub details if user has access" do
      get "/api/hubs/#{hub.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq(hub.id)
      expect(json["name"]).to eq("Test Hub")
      expect(json["invite_code"]).to eq("HUBTST")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "forbids access if user membership is pending approval" do
      pending_user = create(:user, email: Faker::Internet.email)
      create(:hub_membership, user: pending_user, hub: hub, approved: false)
      get "/api/hubs/#{hub.id}", headers: auth_headers_for(pending_user)
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_membership_pending_approval))
    end

    it "returns not found for non-existent hub" do
      get "/api/hubs/999999", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns trial information for free_unrestricted hub" do
      free_unrestricted_hub = create(:hub, plan: :free_unrestricted, users: [user])
      get "/api/hubs/#{free_unrestricted_hub.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["plan"]).to eq("free_unrestricted")
      expect(json["trial_started_at"]).to be_present
      expect(json["trial_ends_at"]).to be_present
      expect(json).to have_key("trial_active")
      expect(json).to have_key("trial_expired")
    end

    it "returns the viewed hub's User-Agent to a super admin who belongs to another hub" do
      super_admin = create(:user, email: "super@meedan.com", hubs: [hub])
      get "/api/hubs/#{other_hub.id}", headers: auth_headers_for(super_admin)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["user_agent"]).to eq("Suwali/1.0 (Hub #{other_hub.id}; +https://suwali.io)")
    end
  end

  context "when updating a hub" do
    it "updates hub with valid parameters when user is admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          name: "Updated Hub Name"
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("Updated Hub Name")
      expect(hub.reload.name).to eq("Updated Hub Name")
    end

    it "updates contribution_workflow_mode when user is admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          contribution_workflow_mode: "review"
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["contribution_workflow_mode"]).to eq("review")
      expect(hub.reload.contribution_workflow_mode).to eq("review")
    end

    it "updates contribution_audience when user is admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          contribution_audience: "all_end_users"
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["contribution_audience"]).to eq("all_end_users")
      expect(hub.reload.contribution_audience).to eq("all_end_users")
    end

    it "updates contribution_code when user is admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          contribution_code: "MyHub2026"
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["contribution_code"]).to eq("#MyHub2026")
      expect(hub.reload.contribution_code).to eq("#MyHub2026")
    end

    it "returns an error for an invalid contribution_code" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          contribution_code: "my hub"
        }
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to include(I18n.t(:error_hub_invalid_contribution_code))
    end

    it "forbids update when user is editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          name: "Attempted Update"
        }
      }, headers: headers
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
      expect(hub.reload.name).to eq("Test Hub")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          name: "Forbidden Update"
        }
      }, headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end

    it "returns validation errors for invalid parameters" do
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          name: ""
        }
      }, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "updates bot_attributes with language settings" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          bot_attributes: {
            default_language: "pt",
            supported_languages: ["en", "pt", "fr"]
          }
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      hub.reload
      expect(hub.bot_attributes["default_language"]).to eq("pt")
      expect(hub.bot_attributes["supported_languages"]).to eq(["en", "pt", "fr"])
    end

    it "returns not found for non-existent hub" do
      patch "/api/hubs/999999", params: {
        hub: {
          name: "Updated Name"
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when refreshing invite code" do
    it "generates new invite code successfully when user is admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)
      old_invite_code = hub.invite_code
      patch "/api/hubs/#{hub.id}/refresh-invite-code", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["invite_code"]).not_to eq(old_invite_code)
      expect(json["invite_code"]).not_to be_nil
      expect(hub.reload.invite_code).to eq(json["invite_code"])
    end

    it "forbids refresh when user is editor" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      old_invite_code = hub.invite_code
      patch "/api/hubs/#{hub.id}/refresh-invite-code", headers: headers
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
      expect(hub.reload.invite_code).to eq(old_invite_code)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      old_invite_code = hub.invite_code
      patch "/api/hubs/#{hub.id}/refresh-invite-code", headers: other_headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
      expect(hub.reload.invite_code).to eq(old_invite_code)
    end

    it "returns not found for non-existent hub" do
      patch "/api/hubs/999999/refresh-invite-code", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when updating bot_attributes" do
    it "updates bot_attributes with valid parameters" do
      patch "/api/hubs/#{hub.id}", params: {
        hub: {
          bot_attributes: {
            name: "KnowledgeBot",
            description: "Helps users find information",
            tone: "nerd"
          }
        }
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["bot_attributes"]["name"]).to eq("KnowledgeBot")
      expect(json["bot_attributes"]["description"]).to eq("Helps users find information")
      expect(json["bot_attributes"]["tone"]).to eq("nerd")
      expect(hub.reload.bot_attributes["name"]).to eq("KnowledgeBot")
    end

    it "returns bot_attributes in hub details" do
      hub.update(bot_attributes: {name: "TestBot"})
      get "/api/hubs/#{hub.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["bot_attributes"]["name"]).to eq("TestBot")
    end
  end

  context "when previewing bot responses" do
    before do
      hub.update(bot_attributes: {name: "TestBot", description: "I help users", tone: "journalist"})
      create(:external_resource, hub: hub, title: "https://example.com/guide", scenarios: ["role_description"])
    end

    it "generates preview for role_description scenario" do
      allow(KnowledgeService).to receive(:preview).and_return("I'm TestBot. I help users.")
      post "/api/hubs/#{hub.id}/preview?scenario=role_description", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["answer"]).to eq("I'm TestBot. I help users.")
      expect(KnowledgeService).to have_received(:preview).with("role_description", anything)
    end

    it "generates preview for unanswerable_question scenario" do
      allow(KnowledgeService).to receive(:preview).and_return("I don't have information about that.")
      post "/api/hubs/#{hub.id}/preview?scenario=unanswerable_question", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["answer"]).to eq("I don't have information about that.")
    end

    it "generates preview for error_occurred scenario" do
      allow(KnowledgeService).to receive(:preview).and_return("There was an error processing your request.")
      post "/api/hubs/#{hub.id}/preview?scenario=error_occurred", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["answer"]).to eq("There was an error processing your request.")
    end

    it "generates preview for first_message scenario and refreshes cache" do
      allow(KnowledgeService).to receive(:preview).and_return("Welcome. TestBot is here to help.")
      post "/api/hubs/#{hub.id}/preview?scenario=first_message", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["answer"]).to include("Welcome. TestBot is here to help.")
      expect(json["answer"]).to include(I18n.t(:first_message_ai_disclaimer))
    end

    it "generates preview for conversation_closed scenario with sample topics appended" do
      allow(KnowledgeService).to receive(:preview).and_return("This conversation has closed.")
      post "/api/hubs/#{hub.id}/preview?scenario=conversation_closed", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["answer"]).to eq("This conversation has closed.\n\n#{I18n.t(:message_closed_window_topics, topics: "Topic 1, Topic 2, and Topic 3")}")
      expect(KnowledgeService).to have_received(:preview).with("conversation_closed", hash_including(default_language: "en"))
    end

    it "generates preview in the requested language" do
      allow(KnowledgeService).to receive(:preview).and_return("Soy TestBot.")
      post "/api/hubs/#{hub.id}/preview?scenario=role_description&language=es", headers: headers
      expect(response).to have_http_status(:ok)
      expect(KnowledgeService).to have_received(:preview).with("role_description", hash_including(default_language: "es"))
    end

    it "ignores an unsupported language and uses the hub default" do
      hub.update(bot_attributes: hub.bot_attributes.merge(default_language: "pt"))
      allow(KnowledgeService).to receive(:preview).and_return("Fechada.")
      post "/api/hubs/#{hub.id}/preview?scenario=conversation_closed&language=xx", headers: headers
      expect(response).to have_http_status(:ok)
      expect(KnowledgeService).to have_received(:preview).with("conversation_closed", hash_including(default_language: "pt"))
    end

    it "ignores a language the hub does not support and uses the hub default" do
      hub.update(bot_attributes: hub.bot_attributes.merge(default_language: "en", supported_languages: ["en", "pt"]))
      allow(KnowledgeService).to receive(:preview).and_return("Welcome.")
      post "/api/hubs/#{hub.id}/preview?scenario=first_message&language=es", headers: headers
      expect(response).to have_http_status(:ok)
      expect(KnowledgeService).to have_received(:preview).with("first_message", hash_including(default_language: "en"))
    end

    it "returns error for invalid scenario" do
      post "/api/hubs/#{hub.id}/preview?scenario=invalid_scenario", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to include("Invalid scenario")
    end

    it "handles Knowledge Service errors" do
      allow(KnowledgeService).to receive(:preview).and_raise(KnowledgeService::Error, "Service unavailable")
      post "/api/hubs/#{hub.id}/preview?scenario=role_description", headers: headers
      expect(response).to have_http_status(:bad_request)
      json = JSON.parse(response.body)
      expect(json["error"]).to include("Service unavailable")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      post "/api/hubs/#{hub.id}/preview?scenario=role_description", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when creating a hub" do
    it "creates a hub successfully and returns 201 with hub data" do
      expect {
        post "/api/hubs", params: {hub: {name: "New Hub"}}, headers: headers
      }.to change(Hub, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("New Hub")
      expect(json["invite_code"]).to be_present
      expect(json["contribution_code"]).to be_present
      expect(json["plan"]).to eq("free")
    end

    it "auto-creates an organization named after the hub" do
      expect {
        post "/api/hubs", params: {hub: {name: "Org Test Hub"}}, headers: headers
      }.to change(Organization, :count).by(1)
      expect(Organization.last.name).to eq("Org Test Hub")
    end

    it "makes the creating user an admin member" do
      post "/api/hubs", params: {hub: {name: "Admin Hub"}}, headers: headers
      created_hub = Hub.find(JSON.parse(response.body)["id"])
      membership = HubMembership.find_by(user: user, hub: created_hub)
      expect(membership).to be_present
      expect(membership.role).to eq("admin")
    end

    it "returns 422 when name is blank" do
      expect {
        post "/api/hubs", params: {hub: {name: ""}}, headers: headers
      }.not_to change(Hub, :count)
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns 422 when name exceeds 100 characters" do
      expect {
        post "/api/hubs", params: {hub: {name: "a" * 101}}, headers: headers
      }.not_to change(Hub, :count)
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns 401 when unauthenticated" do
      post "/api/hubs", params: {hub: {name: "Unauthorized Hub"}}
      expect(response).to have_http_status(:unauthorized)
    end
  end

  context "when listing joinable hubs" do
    let(:domain) { user.email.split("@").last }
    let!(:admin_user) { create(:user, email: "admin@#{domain}") }
    let!(:joinable_hub) { create(:hub, users: [admin_user]) }

    it "returns hubs where an admin shares the user's email domain" do
      get "/api/hubs/joinable", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.map { |h| h["id"] }).to include(joinable_hub.id)
    end

    it "excludes hubs the user is already a member of" do
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      expect(json.map { |h| h["id"] }).not_to include(hub.id)
    end

    it "excludes hubs where the only admin has a different domain" do
      other_admin = create(:user, email: "admin@otherdomain.example")
      injoinable_hub = create(:hub, users: [other_admin])
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      expect(json.map { |h| h["id"] }).not_to include(injoinable_hub.id)
    end

    it "excludes hubs where the matching-domain user is only an editor, not an admin" do
      # Hub's first member (admin) has a different domain; only the editor shares the user's domain
      other_admin = create(:user, email: "admin@otherdomain.example")
      editor_hub = create(:hub, users: [other_admin])
      editor_user = create(:user, email: "editor@#{domain}")
      HubMembership.create!(user: editor_user, hub: editor_hub, role: :editor, approved: true)
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      expect(json.map { |h| h["id"] }).not_to include(editor_hub.id)
    end

    it "excludes hubs where the matching-domain admin is not approved" do
      pending_admin = create(:user, email: "pending@#{domain}")
      pending_hub = create(:hub)
      HubMembership.create!(user: pending_admin, hub: pending_hub, role: :admin, approved: false)
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      expect(json.map { |h| h["id"] }).not_to include(pending_hub.id)
    end

    it "returns at most 5 hubs" do
      5.times do
        extra_admin = create(:user, email: "extra#{rand(10000)}@#{domain}")
        create(:hub, users: [extra_admin])
      end
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      expect(json.length).to be <= 5
    end

    it "returns an empty list for users with a public email domain" do
      gmail_user = create(:user, email: "someone@gmail.com")
      gmail_headers = auth_headers_for(gmail_user)
      get "/api/hubs/joinable", headers: gmail_headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json).to eq([])
    end

    it "returns 401 when not authenticated" do
      get "/api/hubs/joinable"
      expect(response).to have_http_status(:unauthorized)
    end

    it "does not include invite codes in the response" do
      get "/api/hubs/joinable", headers: headers
      json = JSON.parse(response.body)
      joinable = json.find { |h| h["id"] == joinable_hub.id }
      expect(joinable).not_to have_key("invite_code")
      expect(joinable).not_to have_key("contribution_code")
    end
  end

  context "when returning data source items ranking statistics" do
    it "returns the data source items ranking as JSON" do
      create(:message_data_source_item, :document, :external, hub: hub)
      create(:message_data_source_item, :notebook, :external, hub: hub)

      get "/api/hubs/#{hub.id}/message-data-source-items-ranking", headers: headers

      expect(response).to have_http_status(:ok)
      data = response.parsed_body["data"]
      expect(data).to be_an(Array)
      expect(data).not_to be_empty
      data.each { |msdi| expect(msdi).to include("usage_count", "id", "type", "title", "active") }
      expect(response.parsed_body).to have_key("pagination")
    end
  end

  context "when returning questions ranking statistics" do
    let(:conversation) { create(:conversation, hub: hub) }
    let(:cluster) { create(:message_cluster, hub: hub, question_count: 5) }

    def create_question(answered:)
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: incoming, answered: answered == "true")
    end

    it "defaults to answered questions when answered param is omitted" do
      answered_cluster = create(:message_cluster, hub: hub)
      answered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: answered_cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: answered_incoming, answered: true)

      unanswered_cluster = create(:message_cluster, hub: hub)
      unanswered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: unanswered_cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: unanswered_incoming, answered: false)

      get "/api/hubs/#{hub.id}/questions-ranking", headers: headers

      expect(response).to have_http_status(:ok)
      ids = response.parsed_body["data"].map { |d| d["id"] }
      expect(ids).to include(answered_cluster.id)
      expect(ids).not_to include(unanswered_cluster.id)
      expect(response.parsed_body["data"].first.keys).to match_array(%w[id original_text question_count centroid_message_id last_message_body])
      expect(response.parsed_body).to have_key("pagination")
    end

    it "places a mixed cluster in the bucket matching its last message" do
      answered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: answered_incoming, answered: true)
      unanswered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: unanswered_incoming, answered: false)

      get "/api/hubs/#{hub.id}/questions-ranking?answered=true", headers: headers
      expect(response.parsed_body["data"].map { |d| d["id"] }).not_to include(cluster.id)

      get "/api/hubs/#{hub.id}/questions-ranking?answered=false", headers: headers
      expect(response.parsed_body["data"].map { |d| d["id"] }).to include(cluster.id)
    end

    %w[true false].each do |answered|
      it "returns #{(answered == "true") ? "answered" : "unanswered"} questions ranking as JSON" do
        create_question(answered: answered)

        get "/api/hubs/#{hub.id}/questions-ranking?answered=#{answered}", headers: headers

        expect(response).to have_http_status(:ok)
        expect(response.parsed_body["data"].first.keys).to match_array(%w[id original_text question_count centroid_message_id last_message_body])
        expect(response.parsed_body).to have_key("pagination")
      end
    end

    it "returns the filtered question count, not the cluster total count" do
      create_question(answered: "true")

      get "/api/hubs/#{hub.id}/questions-ranking?answered=true", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["data"].first["question_count"]).to eq(1)
    end

    it "ranks only the questions asked inside the requested window" do
      last_week = 1.week.ago.beginning_of_week + 1.day
      old_cluster = create(:message_cluster, hub: hub)
      old_incoming = create(:message, :incoming, conversation: conversation, message_cluster: old_cluster, external_id: SecureRandom.hex, created_at: last_week)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: old_incoming, answered: false, created_at: last_week)
      create_question(answered: "false")

      get "/api/hubs/#{hub.id}/questions-ranking?answered=false&from=#{last_week.beginning_of_week.iso8601}&to=#{last_week.end_of_week.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["data"].map { |d| d["id"] }).to eq([old_cluster.id])
    end

    it "returns the correct last_message_body for each cluster" do
      bodies = ["first question", "second question", "third question"]
      bodies.each do |body|
        c = create(:message_cluster, hub: hub)
        incoming = create(:message, :incoming, conversation: conversation, message_cluster: c, external_id: SecureRandom.hex, body: body)
        create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: incoming, answered: true)
      end

      get "/api/hubs/#{hub.id}/questions-ranking?answered=true", headers: headers

      expect(response.parsed_body["data"].map { |d| d["last_message_body"] }).to match_array(bodies)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Hubs API" do
  path "/api/hubs" do
    post "Creates a new hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub, in: :body, schema: {
        type: :object,
        properties: {
          hub: {
            type: :object,
            required: ["name"],
            properties: {
              name: {type: :string, example: "My Hub"}
            }
          }
        }
      }

      response "201", "Hub created" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub) { {hub: {name: "My New Hub"}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
          json = JSON.parse(response.body)
          expect(json["name"]).to eq("My New Hub")
          expect(json["invite_code"]).to be_present
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub) { {hub: {name: "My New Hub"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "422", "Invalid hub" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub) { {hub: {name: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/hubs/{id}" do
    get "Shows details of a hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Hub ID"

      response "200", "Hub details" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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
        let(:id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    patch "Updates a hub" do
      tags "Hub"
      consumes "multipart/form-data"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Hub ID"
      parameter name: :hub, in: :formData, schema: {
        type: :object,
        properties: {
          "hub[name]": {type: :string, example: "Updated Hub Name"},
          "hub[profile_picture]": {type: :string, format: :binary},
          "hub[bot_attributes][name]": {type: :string, example: "KnowledgeBot"},
          "hub[bot_attributes][description]": {type: :string, example: "Helps users find information"},
          "hub[bot_attributes][tone]": {type: :string, example: "advocate"}
        }
      }

      response "200", "Hub updated" do
        let!(:user) { create(:user) }
        let!(:existing_hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_hub.id }
        let(:hub) { {"hub" => {name: "Updated Hub Name"}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:hub) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:existing_hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_hub.id }
        let(:hub) { {"hub" => {name: "Updated Hub Name"}} }
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
        let(:id) { 999999 }
        let(:hub) { {"hub" => {name: "Updated Hub Name"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid hub" do
        let!(:user) { create(:user) }
        let!(:existing_hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_hub.id }
        let(:hub) { {name: ""} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/hubs/{id}/refresh-invite-code" do
    patch "Refreshes the invite code of a hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Hub ID"

      response "200", "Invite code refreshed" do
        let!(:user) { create(:user) }
        let!(:existing_hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_hub.id }
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

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:existing_hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_hub.id }
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
        let(:id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{id}/statistics" do
    get "Returns statistics of a hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Hub ID"
      parameter name: :fields, in: :query, type: :string, required: false, description: "Comma-separated list of fields to return"
      parameter name: :from, in: :query, type: :string, required: false, description: "Start date (ISO 8601 format)"
      parameter name: :to, in: :query, type: :string, required: false, description: "End date (ISO 8601 format)"
      parameter name: :group_by, in: :query, type: :string, required: false, enum: %w[day week month range rolling_week], description: "Bucket size for time-series fields (defaults to day). \"range\" returns the whole period as a single bucket; \"rolling_week\" counts seven-day buckets from the start of the window rather than from Monday"
      parameter name: :limit, in: :query, type: :integer, required: false, description: "How many records ranked fields return (defaults to 5, capped at 100)"

      response "200", "Hub statistics" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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
        let(:id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  context "when fetching statistics" do
    let!(:user) { create(:user) }
    let!(:hub) { create(:hub, users: [user]) }
    let(:headers) { auth_headers_for(user) }

    it "returns all statistics when no fields parameter is provided" do
      get "/api/hubs/#{hub.id}/statistics", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json).to include(
        "range",
        "total_conversations",
        "number_of_received_messages",
        "number_of_new_conversations",
        "number_of_continued_conversations",
        "average_timeout_window_interval",
        "average_timeout_window_message_count",
        "unique_end_users"
      )
    end

    it "returns only requested fields when fields parameter is provided" do
      get "/api/hubs/#{hub.id}/statistics?fields=total_conversations,average_timeout_window_interval", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.keys).to contain_exactly("range", "total_conversations", "average_timeout_window_interval")
    end

    it "filters by date range when from and to parameters are provided" do
      from = 1.week.ago.iso8601
      to = Time.now.iso8601
      get "/api/hubs/#{hub.id}/statistics?from=#{from}&to=#{to}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["range"]).to be_an(Array)
      expect(json["range"].length).to eq(2)
    end

    it "returns one bucket per week when group_by is weekly" do
      from = 4.weeks.ago.beginning_of_week
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day)

      get "/api/hubs/#{hub.id}/statistics?fields=number_of_new_conversations&group_by=week&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      buckets = JSON.parse(response.body)["number_of_new_conversations"]
      expect(buckets.keys).to all(satisfy { |key| Date.parse(key).monday? })
      expect(buckets[from.to_date.iso8601]).to eq(1)
    end

    it "returns the top topics of the latest bucket, each with its own series" do
      from = 4.weeks.ago.beginning_of_week
      latest_bucket = Time.now.beginning_of_week
      topic = create(:topic, hub: hub, name: "Deepfake detection")
      conversation = create(:conversation, platform: "whatsapp", hub: hub)
      message = create(:message, :incoming, conversation: conversation, created_at: latest_bucket + 1.hour)
      create(:topic_item, topic: topic, item: message)
      create(:message, :outgoing, conversation: conversation, reply_to: message, answered: true, created_at: latest_bucket + 2.hours)

      get "/api/hubs/#{hub.id}/statistics?fields=top_topics&group_by=week&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      top_topics = JSON.parse(response.body)["top_topics"]
      expect(top_topics.first["name"]).to eq("Deepfake detection")
      expect(top_topics.first["messages"][latest_bucket.to_date.iso8601]).to eq(1)
      expect(top_topics.first["messages"][from.to_date.iso8601]).to eq(0)
      expect(top_topics.first["data_source_items"][latest_bucket.to_date.iso8601]).to eq(0)
    end

    it "returns every active topic as a single range bucket when group_by is range" do
      from = 30.days.ago
      topic = create(:topic, hub: hub, name: "Deepfake detection")
      conversation = create(:conversation, platform: "whatsapp", hub: hub)
      message = create(:message, :incoming, conversation: conversation, created_at: from + 1.day)
      create(:topic_item, topic: topic, item: message)
      create(:message, :outgoing, conversation: conversation, reply_to: message, answered: true, created_at: from + 1.day + 1.hour)

      get "/api/hubs/#{hub.id}/statistics?fields=top_topics&group_by=range&limit=100&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      top_topics = JSON.parse(response.body)["top_topics"]
      expect(top_topics.first["name"]).to eq("Deepfake detection")
      expect(top_topics.first["messages"]).to eq({from.to_date.iso8601 => 1})
      expect(top_topics.first["data_source_items"]).to eq({from.to_date.iso8601 => 0})
    end

    it "returns answered and unanswered question counts per week" do
      from = 3.weeks.ago.beginning_of_week
      latest_bucket = Time.now.beginning_of_week
      conversation = create(:conversation, platform: "whatsapp", hub: hub)
      question = create(:message, :incoming, conversation: conversation, external_id: SecureRandom.hex, created_at: latest_bucket + 1.hour)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: question, answered: false, created_at: latest_bucket + 2.hours)

      get "/api/hubs/#{hub.id}/statistics?fields=questions_by_answered&group_by=week&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      buckets = JSON.parse(response.body)["questions_by_answered"]
      expect(buckets.size).to eq(4)
      expect(buckets.first).to eq({"date" => from.to_date.iso8601, "answered" => 0, "unanswered" => 0})
      expect(buckets.last).to eq({"date" => latest_bucket.to_date.iso8601, "answered" => 0, "unanswered" => 1})
    end

    it "returns new and returning contribution counts per week" do
      from = 3.weeks.ago.beginning_of_week
      latest_bucket = Time.now.beginning_of_week
      conversation = create(:conversation, :external, hub: hub)
      message = create(:message, :incoming, conversation: conversation, created_at: latest_bucket + 1.hour)
      create(:contribution, message: message, hub: hub, created_at: latest_bucket + 1.hour)

      get "/api/hubs/#{hub.id}/statistics?fields=contributions_by_contributor&group_by=week&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      buckets = JSON.parse(response.body)["contributions_by_contributor"]
      expect(buckets.size).to eq(4)
      expect(buckets.first).to eq({"date" => from.to_date.iso8601, "new" => 0, "returning" => 0})
      expect(buckets.last).to eq({"date" => latest_bucket.to_date.iso8601, "new" => 1, "returning" => 0})
    end

    it "returns subscriber counts and weekly document counts per subscribed topic" do
      from = 3.weeks.ago.beginning_of_week
      latest_bucket = Time.now.beginning_of_week
      topic = create(:topic, hub: hub, name: "Deepfake detection")
      create(:topic_subscription, topic: topic, external_user: create(:external_user, hub: hub))
      document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      create(:topic_item, topic: topic, item: document, created_at: latest_bucket + 1.hour)

      get "/api/hubs/#{hub.id}/statistics?fields=subscribed_topics&group_by=week&from=#{from.iso8601}&to=#{Time.now.iso8601}", headers: headers

      expect(response).to have_http_status(:ok)
      subscribed_topics = JSON.parse(response.body)["subscribed_topics"]
      expect(subscribed_topics.first["name"]).to eq("Deepfake detection")
      expect(subscribed_topics.first["subscribers"]).to eq(1)
      expect(subscribed_topics.first["documents"][latest_bucket.to_date.iso8601]).to eq(1)
      expect(subscribed_topics.first["documents"][from.to_date.iso8601]).to eq(0)
    end

    it "ignores invalid fields and only returns valid ones" do
      get "/api/hubs/#{hub.id}/statistics?fields=total_conversations,invalid_field,average_timeout_window_interval", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.keys).to contain_exactly("range", "total_conversations", "average_timeout_window_interval")
      expect(json).not_to have_key("invalid_field")
    end
  end

  path "/api/hubs/{id}/message-data-source-items-ranking" do
    get "Returns the message data source items ranking of a hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]

      parameter name: :id, in: :path, type: :string, description: "Hub ID"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Items per page"

      response "200", "Hub message-data-source-items-ranking" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:page) { 1 }
        let(:per_page) { 10 }

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

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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
        let(:id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{id}/questions-ranking" do
    get "Returns the end-user questions ranking of a hub" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]

      parameter name: :id, in: :path, type: :string, description: "Hub ID"
      parameter name: :answered, in: :query, type: :string, required: false, description: "Answered/Unanswered questions"
      parameter name: :from, in: :query, type: :string, required: false, description: "Only rank questions asked from this date on (ISO 8601 format). Without from/to the ranking covers the hub’s whole history"
      parameter name: :to, in: :query, type: :string, required: false, description: "Only rank questions asked up to this date (ISO 8601 format)"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Items per page"

      response "200", "Hub questions-ranking" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:page) { 1 }
        let(:per_page) { 10 }

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

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
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
        let(:id) { 999999 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{id}/preview" do
    post "Preview bot response for a scenario" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Hub ID"
      parameter name: :scenario, in: :query, required: true, schema: {
        type: :string,
        enum: ["role_description", "unanswerable_question", "error_occurred", "first_message", "speak_to_person", "purchase_subscribe", "conversation_closed"]
      }, description: "Scenario to preview"
      parameter name: :language, in: :query, required: false, type: :string, description: "Language code to preview in; defaults to the hub's default language"

      response "200", "Preview generated successfully" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:scenario) { "role_description" }

        before do
          hub.update(bot_attributes: {name: "TestBot", description: "I help users", tone: "journalist"})
          allow(KnowledgeService).to receive(:preview).and_return("I'm TestBot. I help users.")
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to have_key("answer")
        end
      end

      response "400", "Preview failed" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:scenario) { "role_description" }

        before do
          hub.update(bot_attributes: {name: "TestBot"})
          allow(KnowledgeService).to receive(:preview).and_raise(KnowledgeService::Error, "Service unavailable")
        end

        run_test! do |response|
          expect(response).to have_http_status(:bad_request)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:scenario) { "role_description" }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:scenario) { "role_description" }
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
        let(:id) { 999999 }
        let(:scenario) { "role_description" }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid scenario or no personalization configured" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { hub.id }
        let(:scenario) { "invalid_scenario" }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/hubs/joinable" do
    get "Lists up to 5 hubs the current user is joinable to join" do
      tags "Hub"
      consumes "application/json"
      security [bearerAuth: []]

      response "200", "List of joinable hubs" do
        let!(:user) { create(:user, email: "user@customdomain.example") }
        let!(:admin_user) { create(:user, email: "admin@customdomain.example") }
        let!(:joinable_hub) { create(:hub, users: [admin_user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to be_an(Array)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end
end
