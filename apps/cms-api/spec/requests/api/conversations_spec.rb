require "rails_helper"

RSpec.describe "Conversations API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "CNVRST") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "CNVRSN") }

  let(:valid_attributes) do
    {
      conversation: {
        hub_id: hub.id,
        title: "Chat with Hub"
      }
    }
  end

  context "when creating a new conversation" do
    it "creates with valid parameters" do
      expect {
        post "/api/conversations", params: valid_attributes, headers: headers
      }.to change(Conversation, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["title"]).to eq("Chat with Hub")
      expect(json["participant_id"]).to eq(user.id)
      expect(json["participant_type"]).to eq("User")
      expect(json["platform"]).to eq("internal")
    end

    it "returns validation errors if title is blank" do
      post "/api/conversations", params: {conversation: {hub_id: hub.id, title: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      post "/api/conversations", params: {
        conversation: {
          hub_id: other_hub.id,
          title: "External Hub Conversation"
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when updating an existing conversation" do
    let!(:conversation) { create(:conversation, hub: hub, participant: user, title: "Old Title") }

    it "updates the conversation" do
      patch "/api/conversations/#{conversation.id}", params: {conversation: {title: "New Title"}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["title"]).to eq("New Title")
    end

    it "forbids update if user is not the participant of the conversation" do
      other_conversation = create(:conversation, hub: hub, participant: other_user)
      patch "/api/conversations/#{other_conversation.id}", params: {conversation: {title: "Bad Title"}}, headers: headers
      expect(response).to have_http_status(:forbidden)
    end

    it "can't update if title is blank" do
      patch "/api/conversations/#{conversation.id}", params: {conversation: {title: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when deleting a conversation" do
    it "marks the conversation as deleted and returns accepted" do
      conversation = create(:conversation, hub: hub, participant: user)
      expect {
        delete "/api/conversations/#{conversation.id}", headers: headers
      }.not_to change(Conversation, :count)
      expect(response).to have_http_status(:accepted)
      expect(conversation.reload.deleted?).to be true
    end

    it "hides deleted conversation from index" do
      conversation = create(:conversation, hub: hub, participant: user, deleted_at: Time.current)
      get "/api/hubs/#{hub.id}/conversations", headers: headers
      json = JSON.parse(response.body)
      expect(json["data"].map { |c| c["id"] }).not_to include(conversation.id)
    end

    it "returns not found for a deleted conversation" do
      conversation = create(:conversation, hub: hub, participant: user, deleted_at: Time.current)
      delete "/api/conversations/#{conversation.id}", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns forbidden if user is not the participant of the conversation" do
      conversation = create(:conversation, hub: hub, participant: other_user)
      expect {
        delete "/api/conversations/#{conversation.id}", headers: headers
      }.to_not change(Conversation, :count)
      expect(response).to have_http_status(:forbidden)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("You're not allowed to perform this operation")
    end

    it "returns forbidden if a write super admin is not the participant of an internal conversation" do
      write_super_admin = create(:user, email: "super@meedan.com", admin_write_access: true)
      conversation = create(:conversation, hub: hub, participant: other_user)

      delete "/api/conversations/#{conversation.id}", headers: auth_headers_for(write_super_admin)

      expect(response).to have_http_status(:forbidden)
      expect(conversation.reload).not_to be_deleted
    end
  end

  context "when a user requests an external conversation deletion" do
    let!(:write_super_admin) { create(:user, email: "super@meedan.com", admin_write_access: true) }
    let!(:external_user) { create(:external_user, hub: hub, external_id: "shared-id") }
    let!(:conversation) { create(:conversation, :external, hub: hub, participant: external_user) }
    let!(:message) { create(:message, :incoming, conversation: conversation, body: "Deleted question") }
    let!(:other_conversation) { create(:conversation, :external, hub: hub, participant: create(:external_user, hub: hub, external_id: "other-id")) }
    let!(:other_message) { create(:message, :incoming, conversation: other_conversation, body: "Surviving question") }

    def request_deletion(as:, conversation_id: conversation.id)
      Sidekiq::Worker.clear_all
      delete "/api/conversations/#{conversation_id}", headers: auth_headers_for(as)
      DestroyConversationWithMessagesWorker.drain
    end

    it "deletes the requested conversation when requested by a write super admin" do
      request_deletion(as: write_super_admin)

      expect(response).to have_http_status(:accepted)
      expect(Conversation.where(id: conversation.id)).not_to exist
      expect(Message.where(id: message.id)).not_to exist
    end

    it "does not delete the requested conversation when requested by a hub admin" do
      hub_admin = create(:hub_membership, hub: hub, role: :admin, user: create(:user)).user

      request_deletion(as: hub_admin)

      expect(response).to have_http_status(:forbidden)
      expect(conversation.reload).not_to be_deleted
    end

    it "does not delete the requested conversation when requested by a read-only super admin" do
      request_deletion(as: create(:user, email: "readonly@meedan.com", admin_write_access: false))

      expect(response).to have_http_status(:forbidden)
      expect(conversation.reload).not_to be_deleted
    end

    it "does not delete the requested conversation when requested by an editor" do
      editor = create(:hub_membership, hub: hub, role: :editor, user: create(:user)).user

      request_deletion(as: editor)

      expect(response).to have_http_status(:forbidden)
      expect(conversation.reload).not_to be_deleted
    end

    it "does not delete un-related conversations" do
      request_deletion(as: write_super_admin)

      expect(other_conversation.reload).not_to be_deleted
      expect(Message.where(id: other_message.id)).to exist
    end

    it "does not delete a conversation in a different hub when requested by that hub's admin" do
      other_hub_admin = create(:hub_membership, hub: other_hub, role: :admin, user: create(:user)).user

      request_deletion(as: other_hub_admin)

      expect(response).to have_http_status(:not_found)
      expect(conversation.reload).not_to be_deleted
    end

    it "deletes the external user when this is their only conversation" do
      request_deletion(as: write_super_admin)

      expect(ExternalUser.where(id: external_user.id)).not_to exist
    end

    it "does not delete the external user from a different hub" do
      other_hub_external_user = create(:external_user, hub: other_hub, external_id: external_user.external_id)

      request_deletion(as: write_super_admin)

      expect(ExternalUser.where(id: other_hub_external_user.id)).to exist
    end

    it "deletes the conversation's contributions" do
      contribution = create(:contribution, message: message, hub: hub)

      request_deletion(as: write_super_admin)

      expect(Contribution.where(id: contribution.id)).not_to exist
    end

    it "requests the contributions removal from the KnowledgeService" do
      contribution = create(:contribution, message: message, hub: hub)

      request_deletion(as: write_super_admin)

      expect(KnowledgeServiceWorker.jobs.map { |job| job["args"] }).to include(["delete_community_knowledge", contribution.id, hub.id])
    end

    it "updates surviving clusters' original_text" do
      cluster = create(:message_cluster, hub: hub, original_text: message.body, question_count: 2, centroid_message_id: message.id)
      [message, other_message].each { |m| m.update_columns(message_cluster_id: cluster.id) }
      other_message.update_columns(embedding: Array.new(1024, 0.2))

      request_deletion(as: write_super_admin)

      cluster.reload
      expect(cluster.original_text).to eq("Surviving question")
      expect(cluster.centroid_message_id).to eq(other_message.id)
      expect(cluster.question_count).to eq(1)
    end

    it "does not leave stale orphaned clusters" do
      second_message = create(:message, :incoming, conversation: conversation, body: "Deleted follow-up")
      cluster = create(:message_cluster, hub: hub, original_text: second_message.body, question_count: 2, centroid_message_id: second_message.id)
      [message, second_message].each { |m| m.update_columns(message_cluster_id: cluster.id) }

      request_deletion(as: write_super_admin)

      expect(MessageCluster.where(id: cluster.id)).not_to exist
    end

    it "removes deleted conversation messages from clusters" do
      cluster = create(:message_cluster, hub: hub, original_text: other_message.body, question_count: 2, centroid_message_id: other_message.id)
      [message, other_message].each { |m| m.update_columns(message_cluster_id: cluster.id) }

      request_deletion(as: write_super_admin)

      cluster.reload
      expect(cluster.messages).to contain_exactly(other_message)
      expect(cluster.question_count).to eq(1)
    end
  end

  context "when listing conversations" do
    let!(:conversation) { create(:conversation, hub: hub, participant: user, title: "Conversation 1") }
    let!(:other_conversation) { create(:conversation, hub: hub, participant: user, title: "Conversation 2") }
    let!(:other_participant) { create(:user, email: Faker::Internet.email) }
    let!(:other_participant_membership) { create(:hub_membership, hub: hub, user: other_participant) }
    let!(:other_participant_conversation) { create(:conversation, hub: hub, participant: other_participant, title: "Conversation 3") }
    let!(:super_admin_conversation) { create(:conversation, hub: hub, participant: create(:user, email: "admin@meedan.org"), title: "Conversation 4") }
    let!(:external_conversation) { create(:conversation, platform: "telegram", hub: hub, participant: create(:external_user, hub: hub), title: "Conversation 5") }

    it "returns user conversations if user has access to hub" do
      get "/api/hubs/#{hub.id}/my-conversations", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].size).to eq(3)
      expect(json["data"].map { |d| d["title"] }).to include("My First Conversation", "Conversation 1", "Conversation 2")
      expect(json["pagination"]).to be_present
      expect(json["pagination"]["total_count"]).to eq(3)
    end

    it "returns the window around one of the user's conversations sorted by participant" do
      get "/api/hubs/#{hub.id}/my-conversations", params: {sort_by: "conversations.participant_id", sort_direction: "asc", around_id: conversation.id, window_size: 20}, headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["title"] }).to contain_exactly("My First Conversation", "Conversation 1", "Conversation 2")
      expect(json["pagination"]).to include("target_record_id" => conversation.id, "total_count" => 3)
    end

    it "returns not found if user is not part of the hub for user conversations" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/my-conversations", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns hub conversations if user has access to hub" do
      require "rspec-sqlimit"
      expect {
        get "/api/hubs/#{hub.id}/conversations", headers: headers
      }.not_to exceed_query_limit(12) # (1) Authenticate user (2) Load hub (3) Count conversations (4) Load conversations (5 - 8) Load all users from all conversations, including their profile pictures (9 - 11) Audit stuff (12) Check if membership is approved
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].size).to eq(6)
      expect(json["data"].map { |d| d["title"] }).to include("My First Conversation", "Conversation 1", "Conversation 2", "Conversation 3")
      expect(json["pagination"]).to be_present
      expect(json["pagination"]["total_count"]).to eq(6)
    end

    it "includes the conversation context in the hub conversations list" do
      external_conversation.update!(context: [{"id" => "n1", "text" => "Lives in Lagos"}])
      get "/api/hubs/#{hub.id}/conversations", headers: headers
      json = JSON.parse(response.body)
      expect(json["data"].find { |d| d["id"] == external_conversation.id }["context"]).to eq([{"id" => "n1", "text" => "Lives in Lagos"}])
    end

    it "returns not found if user is not part of the hub for hub conversations" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/conversations", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "hides conversations from non-member participants for regular members" do
      non_member = create(:user, email: Faker::Internet.email)
      create(:conversation, hub: hub, participant: non_member, title: "Hidden Conversation")

      get "/api/hubs/#{hub.id}/conversations", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["title"] }).not_to include("Hidden Conversation")
    end

    it "returns all hub conversations to super admins regardless of participant membership" do
      super_admin = create(:user, email: "super@meedan.com")
      non_member = create(:user, email: Faker::Internet.email)
      create(:conversation, hub: hub, participant: non_member, title: "Hidden Conversation")

      get "/api/hubs/#{hub.id}/conversations", headers: auth_headers_for(super_admin)
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["title"] }).to include("Hidden Conversation")
    end

    it "returns the first window when the conversation to center on isn't in the list" do
      get "/api/hubs/#{hub.id}/conversations", params: {around_id: 0, window_size: 20, sort_by: "updated_at", sort_direction: "desc"}, headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      newest = hub.conversations.listed_for(user).order(updated_at: :desc, id: :desc).first
      expect(json["pagination"]).to include("type" => "permalink", "target_record_id" => newest.id, "has_previous" => false)
    end

    it "supports filter and sort options" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        date_modified: "last_7_days",
        notebooks: "true",
        first_message: "last_30_days",
        last_message: "last_7_days",
        participants: "anonymous,trusted",
        platforms: "whatsapp,telegram",
        sort_by: "last_message",
        sort_direction: "desc",
        has_message: "2026-01-01,2026-01-31"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports sort by messages_count" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        notebooks: "false",
        sort_by: "messages_count",
        sort_direction: "desc"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports sort by trusted_user" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        sort_by: "trusted_user",
        sort_direction: "asc"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    context "when sorting by the person" do
      def audience_conversation(external_id, display_name: nil, trusted: false)
        participant = create(:external_user, hub: hub, external_id: external_id, display_name: display_name, trusted_user: trusted)
        create(:conversation, hub: hub, platform: 1, participant: participant)
      end

      def listed_names(params)
        get "/api/hubs/#{hub.id}/conversations", params: params, headers: headers
        expect(response).to have_http_status(:ok)
        JSON.parse(response.body)["data"].map { |d| d["participant"]["name"] }
      end

      it "orders audience conversations by the name shown, mixing in anonymous people by id" do
        # Created out of alphabetical order, and the anonymous people span a digit-count boundary
        audience_conversation("a1", display_name: "carla", trusted: true)
        audience_conversation("a2")
        audience_conversation("a3", display_name: "Alice", trusted: true)
        audience_conversation("a4", display_name: "Zed", trusted: true)

        asc = listed_names(from: "audience", sort_by: "user", sort_direction: "asc")

        anonymous = asc.select { |name| name.start_with?("user-") }
        expect(asc.reject { |name| name.start_with?("user-") }).to eq(["Alice", "carla", "Zed"])
        expect(asc.index("carla")).to be < asc.index(anonymous.first)
        expect(asc.index(anonymous.first)).to be < asc.index("Zed")
        expect(listed_names(from: "audience", sort_by: "user", sort_direction: "desc")).to eq(asc.reverse)
      end

      it "orders anonymous people numerically, not as text" do
        # As text, user-10000 would come before user-8000
        [10_000, 8_000].each do |id|
          participant = create(:external_user, id: id, hub: hub, external_id: "n#{id}", trusted_user: false)
          create(:conversation, hub: hub, platform: 1, participant: participant)
        end

        names = listed_names(from: "audience", sort_by: "user", sort_direction: "asc")

        expect(names.select { |name| %w[user-8000 user-10000].include?(name) }).to eq(%w[user-8000 user-10000])
      end

      it "falls back to the anonymous label for a trusted person without a name" do
        audience_conversation("b1", display_name: "", trusted: true)
        audience_conversation("b2", display_name: "Mia", trusted: true)

        names = listed_names(from: "audience", sort_by: "user", sort_direction: "asc")

        expect(names.first).to eq("Mia")
      end

      it "orders the window around a conversation the same way" do
        conversations = %w[Dora Alice Carla Bea Eve].each_with_index.map do |name, i|
          audience_conversation("w#{i}", display_name: name, trusted: true)
        end
        carla = conversations[2]

        get "/api/hubs/#{hub.id}/conversations", params: {from: "audience", sort_by: "user", sort_direction: "asc", around_id: carla.id, window_size: 2}, headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["data"].map { |d| d["participant"]["name"] }).to eq(%w[Bea Carla Dora])
        expect(json["pagination"]).to include("target_record_id" => carla.id, "target_position" => 2, "has_previous" => true, "has_next" => true)
      end

      it "starts the window at the first person when the conversation to center on isn't in the list" do
        %w[Dora Alice].each_with_index { |name, i| audience_conversation("m#{i}", display_name: name, trusted: true) }

        get "/api/hubs/#{hub.id}/conversations", params: {from: "audience", sort_by: "user", sort_direction: "asc", around_id: 0, window_size: 20}, headers: headers

        json = JSON.parse(response.body)
        expect(json["data"].first["participant"]["name"]).to eq("Alice")
        expect(json["pagination"]).to include("type" => "permalink", "target_position" => 1, "has_previous" => false)
      end

      it "starts the window at the first person when there is no conversation to center on" do
        %w[Dora Alice Carla].each_with_index { |name, i| audience_conversation("f#{i}", display_name: name, trusted: true) }

        names = listed_names(from: "audience", sort_by: "user", sort_direction: "asc", window_size: 20)

        expect(names.first(3)).to eq(%w[Alice Carla Dora])
      end

      it "orders team conversations by the team member's name" do
        zed = create(:user, name: "Zed Team", email: "zed@example.com")
        amy = create(:user, name: "amy team", email: "amy@example.com")
        [zed, amy].each do |member|
          create(:hub_membership, hub: hub, user: member, approved: true)
          conversation = create(:conversation, hub: hub, participant: member)
          conversation.update_columns(messages_count: 1)
        end

        expect(listed_names(from: "team", sort_by: "user", sort_direction: "asc")).to eq(["amy team", "Zed Team"])
        expect(listed_names(from: "team", sort_by: "user", sort_direction: "desc")).to eq(["Zed Team", "amy team"])
      end

      it "lists a person once however many messages match the message date filter" do
        conversation = audience_conversation("c1", display_name: "Bea", trusted: true)
        2.times { create(:message, :incoming, conversation: conversation, created_at: Time.zone.parse("2026-01-10")) }

        names = listed_names(from: "audience", sort_by: "user", sort_direction: "asc", has_message: "2026-01-01,2026-01-31")

        expect(names).to eq(["Bea"])
      end

      it "orders a window of the conversations the message date filter keeps" do
        %w[Dora Alice Carla].each_with_index do |name, i|
          conversation = audience_conversation("m#{i}", display_name: name, trusted: true)
          create(:message, :incoming, conversation: conversation, created_at: Time.zone.parse("2026-01-10"))
        end

        names = listed_names(from: "audience", sort_by: "user", sort_direction: "asc", has_message: "2026-01-01,2026-01-31", window_size: 20)

        expect(names).to eq(%w[Alice Carla Dora])
      end
    end

    it "supports filter by participant type - anonymous only" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        participants: "anonymous"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports filter by participant type - trusted only" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        participants: "trusted"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports filter by participant type - internal only" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        participants: "internal"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports filter by participant type - anonymous and internal" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        participants: "anonymous,internal"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports filter by participant type - internal and trusted" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        participants: "internal,trusted"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "supports filter by message in date range" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        has_message: "2026-01-01,2026-01-31"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "filters by from = 'audience' (only non-internal platforms)" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        from: "audience"
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"]).to_not be_empty
      json["data"].each do |d|
        expect(d["platform"]).not_to eq("internal")
        expect(d["participant"]["id"]).not_to eq(user.id)
      end
    end

    it "filters by from = 'me' (only current user's conversations)" do
      get "/api/hubs/#{hub.id}/conversations", params: {
        from: "me"
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"]).to_not be_empty
      json["data"].each do |d|
        expect(d["platform"]).to eq("internal")
        expect(d["participant"]["id"]).to eq(user.id)
      end
    end

    it "filters by from = 'team' (internal platform, including current user, must have messages)" do
      own_conversation = create(:conversation, hub: hub, participant: user)
      create(:message, :outgoing, conversation: own_conversation)
      create(:conversation, hub: hub, participant: user)

      get "/api/hubs/#{hub.id}/conversations", params: {
        from: "team"
      }, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["id"] }).to eq([own_conversation.id])
      json["data"].each do |d|
        expect(d["platform"]).to eq("internal")
      end
    end
  end

  context "when getting one conversation" do
    let!(:conversation) { create(:conversation, hub: hub, participant: user, title: "Conversation 1") }

    it "returns conversation if user has access to hub" do
      get "/api/conversations/#{conversation.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["title"]).to eq("Conversation 1")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/conversations/#{conversation.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "forbids access to conversation if user membership is not approved" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      create(:hub_membership, user: another_user, hub: conversation.hub, approved: false)
      get "/api/conversations/#{conversation.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "forbids access to conversation if it does not exist" do
      get "/api/conversations/99999999999", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found to regular members for a conversation hidden from the list" do
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email))
      get "/api/conversations/#{hidden_conversation.id}", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns a conversation from another member" do
      member = create(:user, email: Faker::Internet.email)
      create(:hub_membership, hub: hub, user: member)
      member_conversation = create(:conversation, hub: hub, participant: member)
      get "/api/conversations/#{member_conversation.id}", headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(member_conversation.id)
    end

    it "returns an external conversation" do
      external_conversation = create(:conversation, platform: "telegram", hub: hub, participant: create(:external_user, hub: hub))
      get "/api/conversations/#{external_conversation.id}", headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(external_conversation.id)
    end

    it "returns the conversation as the list does, without an untrusted end-user's external id" do
      end_user = create(:external_user, hub: hub, trusted_user: false)
      external_conversation = create(:conversation, platform: "telegram", hub: hub, participant: end_user)
      get "/api/conversations/#{external_conversation.id}", headers: headers
      json = JSON.parse(response.body)
      expect(json).to include("id" => external_conversation.id, "hub_id" => hub.id)
      expect(json["participant"]).to include("id" => end_user.id, "type" => "ExternalUser", "external_id" => nil)
    end

    it "returns a conversation hidden from the list to super admins" do
      super_admin = create(:user, email: "super@meedan.com")
      hidden_conversation = create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email))
      get "/api/conversations/#{hidden_conversation.id}", headers: auth_headers_for(super_admin)
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["id"]).to eq(hidden_conversation.id)
    end
  end

  context "when exporting a conversation" do
    let!(:super_admin) { create(:user, email: "super@meedan.com") }
    let!(:external_conversation) { create(:conversation, :external, hub: hub, participant: create(:external_user, hub: hub)) }
    let!(:external_message) { create(:message, :incoming, conversation: external_conversation) }

    def request_export(as:, conversation_id: external_conversation.id)
      get "/api/hubs/#{hub.id}/conversations/#{conversation_id}/export", headers: auth_headers_for(as)
    end

    it "returns an external conversation as a CSV attachment to a super admin" do
      request_export(as: super_admin)

      expect(response).to have_http_status(:ok)
      expect(response.content_type).to eq("text/csv")
      expect(response.headers["Content-Disposition"]).to include("attachment")
      expect(response.headers["Content-Disposition"]).to match(/suwali-conversation-#{external_conversation.id}-export-\d{4}-\d{2}-\d{2}\.csv/)
      rows = CSV.parse(response.body, headers: true)
      expect(rows.headers).to eq(ConversationCsvExporter::HEADERS)
      expect(rows.map { |row| row.to_h.values_at("convo_id", "message_id") }).to eq([[external_conversation.id.to_s, external_message.id.to_s]])
    end

    it "returns an internal conversation to a super admin" do
      internal_conversation = create(:conversation, hub: hub, participant: user)
      internal_message = create(:message, :incoming, conversation: internal_conversation)

      request_export(as: super_admin, conversation_id: internal_conversation.id)

      expect(response).to have_http_status(:ok)
      rows = CSV.parse(response.body, headers: true)
      expect(rows.map { |row| row.to_h.values_at("convo_id", "user_type", "message_id") }).to eq([[internal_conversation.id.to_s, "HubUser", internal_message.id.to_s]])
    end

    it "forbids a hub admin who is not a super admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)

      request_export(as: user)

      expect(response).to have_http_status(:forbidden)
    end

    it "requires authentication" do
      get "/api/hubs/#{hub.id}/conversations/#{external_conversation.id}/export"

      expect(response).to have_http_status(:unauthorized)
    end

    it "returns not found for a soft-deleted conversation" do
      external_conversation.update!(deleted_at: Time.current)

      request_export(as: super_admin)

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for a conversation of another hub" do
      other_conversation = create(:conversation, hub: other_hub, participant: other_user)

      request_export(as: super_admin, conversation_id: other_conversation.id)

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for an unknown hub" do
      get "/api/hubs/0/conversations/#{external_conversation.id}/export", headers: auth_headers_for(super_admin)

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found for an unknown conversation" do
      request_export(as: super_admin, conversation_id: 0)

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)).to eq({"errors" => [I18n.t(:error_not_found)]})
    end
  end

  context "when starting a bulk export" do
    let!(:super_admin) { create(:user, email: "super@meedan.com") }

    def request_bulk_export(as:, hub_id: hub.id)
      post "/api/hubs/#{hub_id}/conversations/bulk-export", headers: auth_headers_for(as)
    end

    it "creates a pending export requested by the super admin and enqueues it" do
      expect { request_bulk_export(as: super_admin) }.to change(BulkConversationExportWorker.jobs, :size).by(1)

      expect(response).to have_http_status(:accepted)
      export = hub.bulk_conversation_exports.sole
      expect(export.requested_by).to eq(super_admin)
      expect(JSON.parse(response.body)).to include("id" => export.id, "status" => "pending", "download_url" => nil)
    end

    it "returns the hub's pending export instead of creating another" do
      pending_export = create(:bulk_conversation_export, hub: hub)

      expect { request_bulk_export(as: super_admin) }.not_to change(BulkConversationExport, :count)

      expect(response).to have_http_status(:accepted)
      expect(JSON.parse(response.body)["id"]).to eq(pending_export.id)
    end

    it "returns the export a concurrent request created between the pending check and the insert" do
      concurrent_export = create(:bulk_conversation_export, hub: hub)
      allow(BulkConversationExport).to receive(:pending).and_return(BulkConversationExport.none)

      expect { request_bulk_export(as: super_admin) }.not_to change(BulkConversationExportWorker.jobs, :size)

      expect(BulkConversationExport).to have_received(:pending)
      expect(response).to have_http_status(:accepted)
      expect(hub.bulk_conversation_exports.sole).to eq(concurrent_export)
      expect(JSON.parse(response.body)["id"]).to eq(concurrent_export.id)
    end

    it "creates a new export when the previous one is no longer pending" do
      create(:bulk_conversation_export, hub: hub, status: :ready)

      expect { request_bulk_export(as: super_admin) }.to change(BulkConversationExport, :count).by(1)
    end

    it "forbids a hub admin who is not a super admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)

      request_bulk_export(as: user)

      expect(response).to have_http_status(:forbidden)
    end

    it "requires authentication" do
      post "/api/hubs/#{hub.id}/conversations/bulk-export"

      expect(response).to have_http_status(:unauthorized)
    end

    it "returns not found for an unknown hub" do
      request_bulk_export(as: super_admin, hub_id: 0)

      expect(response).to have_http_status(:not_found)
    end
  end

  context "when polling the latest bulk export" do
    let!(:super_admin) { create(:user, email: "super@meedan.com") }

    def request_latest(as:)
      get "/api/hubs/#{hub.id}/conversations/bulk-export/latest", headers: auth_headers_for(as)
    end

    it "returns null when the hub has no export" do
      create(:bulk_conversation_export, hub: other_hub)

      request_latest(as: super_admin)

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to be_nil
    end

    it "returns the hub's most recent export, whoever requested it" do
      create(:bulk_conversation_export, hub: hub, status: :failed)
      latest = create(:bulk_conversation_export, hub: hub)

      request_latest(as: super_admin)

      expect(JSON.parse(response.body)).to eq(
        "id" => latest.id, "status" => "pending", "created_at" => latest.created_at.as_json,
        "expires_at" => latest.expires_at.as_json, "download_url" => nil
      )
    end

    it "includes a download URL once the export is ready" do
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      create(:bulk_conversation_export, :ready, hub: hub)

      request_latest(as: super_admin)

      expect(JSON.parse(response.body)["download_url"]).to include("X-Amz-Expires")
    end

    it "forbids a hub admin who is not a super admin" do
      hub.hub_memberships.find_by(user: user).update!(role: :admin)

      request_latest(as: user)

      expect(response).to have_http_status(:forbidden)
    end

    it "requires authentication" do
      get "/api/hubs/#{hub.id}/conversations/bulk-export/latest"

      expect(response).to have_http_status(:unauthorized)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Conversations API" do
  path "/api/conversations" do
    post "Creates a conversation" do
      tags "Conversation"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :conversation, in: :body, schema: {
        type: :object,
        properties: {
          conversation: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              title: {type: :string, example: "Chat with Hub"}
            },
            required: ["hub_id", "title"]
          }
        },
        required: ["conversation"]
      }

      response "201", "Conversation created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation) { {"conversation" => {hub_id: hub.id, title: "Chat with Hub"}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:conversation) { {"conversation" => {title: "Chat with Hub"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation) { {"conversation" => {hub_id: hub.id, title: "Chat with Hub"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:conversation) { {"conversation" => {hub_id: hub.id, title: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/conversations/{id}" do
    patch "Updates a conversation" do
      tags "Conversation"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Conversation ID"
      parameter name: :conversation, in: :body, schema: {
        type: :object,
        properties: {
          conversation: {
            type: :object,
            properties: {
              id: {type: :integer, example: 1},
              title: {type: :string, example: "Chat with Hub, updated"}
            },
            required: ["id", "title"]
          }
        },
        required: ["conversation"]
      }

      response "200", "Conversation updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        let(:conversation) { {"conversation" => {title: "Chat with Hub, updated"}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:conversation) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:existing_conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        let(:conversation) { {"conversation" => {title: "Chat with Hub, updated"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Conversation not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:conversation) { {"conversation" => {title: "Chat with Hub, updated"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        let(:conversation) { {"conversation" => {title: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    delete "Deletes a conversation" do
      tags "Conversation"
      description "Internal conversations can only be deleted by their participant; external ones by write super admins."
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Conversation ID"

      response "202", "Conversation deletion accepted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "Forbidden (deleting an external conversation without write super admin access)" do
        let!(:hub) { create(:hub, users: [create(:user)]) }
        let!(:editor) { create(:hub_membership, hub: hub, role: :editor, user: create(:user)).user }
        let!(:existing_conversation) { create(:conversation, :external, hub: hub, participant: create(:external_user, hub: hub)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(editor, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "Not found (no membership)" do
        let!(:user) { create(:user) }
        let!(:existing_conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Conversation not found" do
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

  path "/api/hubs/{hub_id}/conversations" do
    get "Lists the conversations of a hub" do
      tags "Conversation"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists conversations of a hub" do
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

  path "/api/hubs/{hub_id}/my-conversations" do
    get "Lists the user's conversations in a hub" do
      tags "Conversation"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists my conversations in a hub" do
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

  path "/api/conversations/{id}" do
    get "Get a single conversation" do
      tags "Conversation"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Conversation ID"

      response "200", "Get a conversation" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:another_conversation) { create(:conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { another_conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/conversations/{id}/export" do
    get "Exports a conversation's messages as CSV" do
      tags "Conversation"
      produces "text/csv"
      security [bearerAuth: []]
      description "Super admin only endpoint. Exports the latest #{ConversationCsvExporter::MAX_MESSAGES} messages of an external or internal conversation, oldest first, without the participant's personal data."
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :id, in: :path, type: :string, description: "Conversation ID"

      response "200", "CSV export of the conversation" do
        let!(:super_admin) { create(:user, email: "super@meedan.com") }
        let!(:conversation) { create(:conversation, :external) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { conversation.hub_id }
        let(:id) { conversation.id }
        run_test! do |response|
          expect(response.content_type).to eq("text/csv")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "Forbidden for users who are not super admins" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:conversation) { create(:conversation, hub: hub, participant: user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "Not found" do
        let!(:super_admin) { create(:user, email: "super@meedan.com") }
        let!(:hub) { create(:hub) }
        let!(:another_conversation) { create(:conversation) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:id) { another_conversation.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/conversations/bulk-export" do
    post "Starts a CSV export of a hub's conversations" do
      tags "Conversation"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint. Builds a CSV of the hub's latest #{BulkConversationExport::MAX_CONVERSATIONS} conversations in the background. Returns the hub's pending export instead when one is already running. Poll the latest endpoint for its download URL."
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "202", "Export started, or the pending one returned" do
        let!(:super_admin) { create(:user, email: "super@meedan.com") }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(JSON.parse(response.body)["status"]).to eq("pending")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "Forbidden for users who are not super admins" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/conversations/bulk-export/latest" do
    get "Returns the hub's most recent conversation export" do
      tags "Conversation"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint. Returns the hub's most recent bulk export, or null. download_url is set only while the export is ready and within its #{BulkConversationExport::TTL.inspect} TTL; it is signed per request, so fetch it right before downloading."
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "The latest export, or null" do
        let!(:super_admin) { create(:user, email: "super@meedan.com") }
        let!(:export) { create(:bulk_conversation_export) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { export.hub_id }
        run_test! do |response|
          expect(JSON.parse(response.body)["id"]).to eq(export.id)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "403", "Forbidden for users who are not super admins" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end
    end
  end
end
