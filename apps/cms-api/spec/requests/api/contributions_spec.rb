require "rails_helper"

RSpec.describe "Contributions API", type: :request do
  let!(:user) { create(:user) }
  let!(:other_user) { create(:user, email: Faker::Internet.email) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "CNTRBT") }
  let!(:other_hub) { create(:hub, users: [other_user], invite_code: "CNTRBN") }

  context "when getting a contribution" do
    let!(:contribution) { create(:contribution, hub: hub, content: "Contribution 1") }

    it "returns the contribution if user has access to hub" do
      get "/api/contributions/#{contribution.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq(contribution.id)
      expect(json["content"]).to eq("Contribution 1")
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/contributions/#{contribution.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if contribution doesn't exist" do
      get "/api/contributions/0", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when listing contributions" do
    let!(:contribution) { create(:contribution, hub: hub, content: "Contribution 1") }
    let!(:other_contribution) { create(:contribution, hub: hub, content: "Contribution 2") }

    it "returns contributions if user has access to hub" do
      get "/api/hubs/#{hub.id}/contributions", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].size).to eq(2)
      expect(json["data"].map { |d| d["content"] }).to include("Contribution 1", "Contribution 2")
      expect(json["pagination"]).to be_present
      expect(json["pagination"]["total_count"]).to eq(2)
    end

    it "returns the count before filtering beside the filtered total" do
      other_contribution.update!(active: false)
      get "/api/hubs/#{hub.id}/contributions", params: {status: "active"}, headers: headers
      json = JSON.parse(response.body)
      expect(json["pagination"]["total_count"]).to eq(1)
      expect(json["pagination"]["unfiltered_count"]).to eq(2)
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      get "/api/hubs/#{hub.id}/contributions", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "supports filter and sort options" do
      get "/api/hubs/#{hub.id}/contributions", params: {
        status: "active",
        date_modified: "last_7_days",
        notebooks: "true",
        platforms: "whatsapp,telegram",
        sync_status: "complete,pending",
        sort_by: "user",
        sort_direction: "desc"
      }, headers: headers
      expect(response).to have_http_status(:ok)

      # Test sync_status sorting
      get "/api/hubs/#{hub.id}/contributions", params: {
        sort_by: "sync_status",
        sort_direction: "asc"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    context "when sorting by the person" do
      def contribute(participant, platform:, content:)
        conversation = create(:conversation, hub: hub, platform: platform, participant: participant)
        create(:contribution, hub: hub, content: content, message: create(:message, :incoming, conversation: conversation))
      end

      def contributors(direction)
        get "/api/hubs/#{hub.id}/contributions", params: {sort_by: "user", sort_direction: direction}, headers: headers
        expect(response).to have_http_status(:ok)
        JSON.parse(response.body)["data"].map { |d| d["message"]["conversation"]["participant"]["name"] }
      end

      it "orders by the name shown across external users and team members" do
        contribute(create(:external_user, hub: hub, external_id: "p1", display_name: "Zed", trusted_user: true), platform: 1, content: "one")
        contribute(create(:user, name: "amy", email: "amy@example.com"), platform: 0, content: "two")
        contribute(create(:external_user, hub: hub, external_id: "p2", display_name: "Bob", trusted_user: true), platform: 1, content: "three")
        contribute(create(:external_user, hub: hub, external_id: "p3", trusted_user: false), platform: 1, content: "four")

        asc = contributors("asc")

        mine = asc.grep(/\A(amy|Bob|user-|Zed)/).map { |name| name.start_with?("user-") ? "anonymous" : name }
        expect(mine).to eq(%w[amy Bob anonymous Zed])
        expect(asc).to eq(asc.sort_by(&:downcase))
        expect(contributors("desc")).to eq(asc.reverse)
      end

      it "lists each contribution once in the window around one whose message has several topics" do
        bob = contribute(create(:external_user, hub: hub, external_id: "w1", display_name: "Bob", trusted_user: true), platform: 1, content: "bob")
        amy = contribute(create(:external_user, hub: hub, external_id: "w2", display_name: "Amy", trusted_user: true), platform: 1, content: "amy")
        2.times { |i| create(:topic_item, topic: create(:topic, hub: hub, name: "Topic #{i}"), item: amy.message) }

        get "/api/hubs/#{hub.id}/contributions", params: {sort_by: "user", sort_direction: "asc", around_id: amy.id, window_size: 20}, headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        ids = json["data"].map { |d| d["id"] }
        expect(ids).to eq(ids.uniq)
        expect(ids).to include(amy.id, bob.id)
        expect(json["pagination"]).to include("total_count" => ids.size, "target_record_id" => amy.id)
      end
    end

    it "marks each contribution first-time or returning, and dates the contributor's first" do
      user1 = create(:conversation, :external, hub: hub)
      first = create(:contribution, hub: hub, message: create(:message, :incoming, conversation: user1, created_at: 3.weeks.ago), created_at: 3.weeks.ago)
      create(:contribution, hub: hub, message: create(:message, :incoming, conversation: user1, created_at: 1.week.ago), created_at: 1.week.ago)

      get "/api/hubs/#{hub.id}/contributions", params: {sort_by: "created_at", sort_direction: "asc"}, headers: headers

      expect(response).to have_http_status(:ok)
      returned = JSON.parse(response.body)["data"].select { |d| d["message"]["conversation"]["id"] == user1.id }
      expect(returned.map { |d| d["first_time_contributor"] }).to eq([true, false])
      expect(returned.map { |d| Time.zone.parse(d["first_contribution_at"]) }).to all(be_within(1.second).of(first.created_at))
    end

    # Serializing a row reaches for its contributor, so the page has to arrive with them already
    # loaded rather than fetching one per row
    it "costs the same number of queries however many contributors the page holds" do
      def query_count
        count = 0
        subscription = ActiveSupport::Notifications.subscribe("sql.active_record") do |_, _, _, _, payload|
          next if payload[:name].to_s.in?(["SCHEMA", "TRANSACTION"]) || payload[:sql].start_with?("SAVEPOINT", "RELEASE SAVEPOINT")
          count += 1
        end
        yield
        count
      ensure
        ActiveSupport::Notifications.unsubscribe(subscription)
      end

      def seed_contributors(hub, count)
        count.times do
          conversation = create(:conversation, :external, hub: hub)
          2.times { create(:contribution, hub: hub, message: create(:message, :incoming, conversation: conversation)) }
        end
      end

      seed_contributors(hub, 2)
      few = query_count { get "/api/hubs/#{hub.id}/contributions", headers: headers }

      seed_contributors(hub, 6)
      many = query_count { get "/api/hubs/#{hub.id}/contributions", headers: headers }

      expect(response).to have_http_status(:ok)
      expect(many).to eq(few)
    end

    it "does not try to fetch message_data_source_items for a contribution.message" do
      # Contribution has a related incoming message, that incoming message will never have a message_data_source_item
      # message_data_source_item is only related to outgoing messages/bot responses
      get "/api/hubs/#{hub.id}/contributions", headers: headers
      expect(response).to have_http_status(:ok)

      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["message"] }).to all(satisfy { |message| message.exclude?("data_source_items") })
    end
  end

  context "when deleting contributions" do
    let!(:contribution) { create(:contribution, hub: hub, content: "Contribution to delete") }
    let!(:other_hub_contribution) { create(:contribution, hub: other_hub, content: "Other hub contribution") }

    it "deletes contribution if user has access to hub" do
      delete "/api/contributions/#{contribution.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to be_present
      expect(Contribution.exists?(contribution.id)).to be_falsey
    end

    it "forbids deletion if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      delete "/api/contributions/#{contribution.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
      expect(Contribution.exists?(contribution.id)).to be_truthy
    end

    it "forbids deletion of contribution from other hub" do
      delete "/api/contributions/#{other_hub_contribution.id}", headers: headers
      expect(response).to have_http_status(:not_found)
      expect(Contribution.exists?(other_hub_contribution.id)).to be_truthy
    end
  end

  context "when updating a contribution" do
    let!(:contribution) { create(:contribution, hub: hub, content: "Contribution to update") }
    let!(:other_hub_contribution) { create(:contribution, hub: other_hub, content: "Other hub contribution") }

    it "updates the priority_tier" do
      patch "/api/contributions/#{contribution.id}", params: {contribution: {priority_tier: 1}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["priority_tier"]).to eq(1)
      expect(contribution.reload.priority_tier).to eq(1)
    end

    it "updates the active status" do
      patch "/api/contributions/#{contribution.id}", params: {contribution: {active: false}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["active"]).to eq(false)
      expect(contribution.reload.active).to eq(false)
    end

    it "enqueues KnowledgeServiceWorker when active changes to false" do
      contribution.update(active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "delete_community_knowledge", contribution.id, hub.id)
      patch "/api/contributions/#{contribution.id}", params: {contribution: {active: false}}, headers: headers
    end

    it "enqueues KnowledgeServiceWorker when active changes to true" do
      contribution.update(active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", contribution.id)
      patch "/api/contributions/#{contribution.id}", params: {contribution: {active: true}}, headers: headers
    end

    it "forbids update if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      patch "/api/contributions/#{contribution.id}", params: {contribution: {active: false}}, headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "forbids update of contribution from other hub" do
      patch "/api/contributions/#{other_hub_contribution.id}", params: {contribution: {active: false}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns error if contribution doesn't exist" do
      patch "/api/contributions/0", params: {contribution: {active: false}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns error if update fails" do
      allow_any_instance_of(Contribution).to receive(:update).and_return(false)
      allow_any_instance_of(Contribution).to receive(:errors).and_return(
        double(full_messages: ["Update failed"])
      )
      patch "/api/contributions/#{contribution.id}", params: {contribution: {active: false}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to eq(["Update failed"])
    end
  end

  context "when retrying sync" do
    let!(:contribution) { create(:contribution, hub: hub, content: "Test contribution") }

    it "retries ingestion for error status contribution (active)" do
      contribution.update_columns(sync_status: :error, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", contribution.id)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(contribution.reload.sync_status).to eq("pending")
    end

    it "retries deletion for error status contribution (inactive)" do
      contribution.update_columns(sync_status: :error, active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "delete_community_knowledge", contribution.id, hub.id)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(contribution.reload.sync_status).to eq("pending")
    end

    it "retries for pending status contribution" do
      contribution.update_columns(sync_status: :pending, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", contribution.id)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(contribution.reload.sync_status).to eq("pending")
    end

    it "returns error for complete status contribution" do
      contribution.update_column(:sync_status, :complete)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns error for error status contribution with a non-retryable error code" do
      contribution.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
      expect(KnowledgeServiceWorker).not_to receive(:perform_in)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns not found if user is not part of the hub" do
      contribution.update_column(:sync_status, :error)
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      post "/api/contributions/#{contribution.id}/retry-sync", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if contribution doesn't exist" do
      post "/api/contributions/0/retry-sync", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when filtering by topics" do
    let!(:topic) { create(:topic, hub: hub, name: "Housing") }
    let!(:tagged) { create(:contribution, hub: hub, content: "Rents are up").tap { |item| create(:topic_item, topic: topic, item: item) } }
    let!(:untagged) { create(:contribution, hub: hub, content: "No topic yet") }

    def contents_for(params)
      get "/api/hubs/#{hub.id}/contributions", params: params, headers: headers
      expect(response).to have_http_status(:ok)
      JSON.parse(response.body)["data"].map { |c| c["content"] }
    end

    it "returns the contributions that have the topic, or all but them when excluding" do
      expect(contents_for(topics: topic.id.to_s)).to eq(["Rents are up"])
      expect(contents_for(topics: topic.id.to_s, topics_mode: "exclude")).to eq(["No topic yet"])
    end

    it "returns the contributions with no topics for none" do
      expect(contents_for(topics: "none")).to eq(["No topic yet"])
    end
  end

  context "when filtering by participants" do
    def contribution_from(trusted:, content:)
      end_user = create(:external_user, hub: hub, trusted_user: trusted, external_id: SecureRandom.hex(4))
      conversation = create(:conversation, :external, hub: hub, participant: end_user)
      create(:contribution, hub: hub, content: content, message: create(:message, :incoming, conversation: conversation))
    end

    let!(:anonymous) { contribution_from(trusted: false, content: "From anonymous") }
    let!(:trusted) { contribution_from(trusted: true, content: "From trusted") }

    def contents_for(params)
      get "/api/hubs/#{hub.id}/contributions", params: params, headers: headers
      expect(response).to have_http_status(:ok)
      JSON.parse(response.body)["data"].map { |c| c["content"] }
    end

    it "returns the contributions of the type of end-user chosen" do
      expect(contents_for(participants: "anonymous")).to eq(["From anonymous"])
      expect(contents_for(participants: "trusted")).to eq(["From trusted"])
    end

    it "returns both for both types, and everything for none" do
      expect(contents_for(participants: "anonymous,trusted")).to contain_exactly("From anonymous", "From trusted")
      expect(contents_for(participants: "")).to contain_exactly("From anonymous", "From trusted")
    end

    it "stacks with the platform filter and the sort by user" do
      expect(contents_for(participants: "trusted", platforms: "telegram,whatsapp,sms", sort_by: "user")).to eq(["From trusted"])
    end

    it "returns the participant's external_id only for trusted end-users" do
      get "/api/hubs/#{hub.id}/contributions", headers: headers
      external_ids = JSON.parse(response.body)["data"].to_h { |c| [c["content"], c.dig("message", "conversation", "participant", "external_id")] }
      expect(external_ids).to eq("From anonymous" => nil, "From trusted" => trusted.contributor.external_id)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Contributions API" do
  path "/api/hubs/{hub_id}/contributions" do
    get "Lists the contributions of a hub" do
      tags "Contribution"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Items per page"
      parameter name: :topics, in: :query, type: :string, required: false, description: "Topic ids, separated by commas, and \"none\" for the items with no topics. Shows the items that have any of them, or all but those with topics_mode exclude"
      parameter name: :participants, in: :query, type: :string, required: false, description: "The types of end-user to show, separated by commas: anonymous, trusted, or both"
      parameter name: :topics_mode, in: :query, type: :string, required: false, enum: %w[include exclude], description: "Whether the topics filter shows the matching items (the default) or all but them"

      response "200", "Lists contributions of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:page) { 1 }
        let(:per_page) { 10 }

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

  path "/api/contributions/{id}" do
    get "Gets a contribution" do
      tags "Contribution"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Contribution ID"

      response "200", "Contribution found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_contribution.id }
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
        let!(:hub) { create(:hub) }
        let!(:existing_contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Contribution not found" do
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

    patch "Updates a contribution" do
      tags "Contribution"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Contribution ID"
      parameter name: :contribution, in: :body, schema: {
        type: :object,
        properties: {
          contribution: {
            type: :object,
            properties: {
              active: {type: :boolean, example: false},
              priority_tier: {
                type: :integer,
                example: 2,
                description: "Priority tier: -1 (low, preloaded FAQ), 1 (default), 2 (high)"
              }
            }
          }
        },
        required: ["contribution"]
      }

      response "200", "Contribution updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_contribution.id }
        let(:contribution) { {"contribution" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:contribution) { {"contribution" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:existing_contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_contribution.id }
        let(:contribution) { {"contribution" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Contribution not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:contribution) { {"contribution" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    delete "Deletes a contribution" do
      tags "Contribution"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Contribution ID"

      response "200", "Contribution deleted successfully" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let!(:contribution) { create(:contribution) }
        let(:Authorization) { nil }
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:contribution) { create(:contribution, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/contributions/{id}/retry-sync" do
    post "Retries sync for a contribution" do
      tags "Contribution"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Contribution ID"

      response "202", "Sync retry queued" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:contribution) do
          contrib = create(:contribution, hub: hub)
          contrib.update_column(:sync_status, :error)
          contrib
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let!(:contribution) do
          contrib = create(:contribution)
          contrib.update_column(:sync_status, :error)
          contrib
        end
        let(:Authorization) { nil }
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:contribution) do
          contrib = create(:contribution, hub: hub)
          contrib.update_column(:sync_status, :error)
          contrib
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Contribution not found" do
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

      response "422", "Contribution not in retryable state" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:contribution) do
          contrib = create(:contribution, hub: hub)
          contrib.update_column(:sync_status, :complete)
          contrib
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { contribution.id }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end
end
