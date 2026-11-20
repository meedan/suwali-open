require "rails_helper"

RSpec.describe "Admin API", type: :request do
  let(:super_admin) { create(:user, email: "admin@meedan.com") }
  let(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
  let(:regular_user) { create(:user, email: "user@example.com") }

  describe "GET /api/admin/hubs" do
    context "when user is a super admin" do
      it "returns hubs as a JSON array with the expected fields" do
        telegram_service_double = instance_double(TelegramService)
        allow(TelegramService).to receive(:new).with("token").and_return(telegram_service_double)
        allow(telegram_service_double).to receive(:set_webhook).and_return(double("response", success?: true))
        allow(telegram_service_double).to receive(:get_me).and_return(double("response", success?: true, "[]": {"result" => {}}))

        hub = create(:hub, plan: :standard)
        create(:telegram_messaging_integration, hub: hub, credentials: {bot_token: "token"})
        create(:whatsapp_messaging_integration, hub: hub, credentials: {phone_number_id: "phone_id", business_token: "token"})
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to be_an(Array)

        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data).to include(
          "id" => hub.id,
          "name" => hub.name,
          "plan" => "standard",
          "invite_code" => hub.invite_code,
          "trial_active" => false,
          "trial_expired" => false
        )
        expect(hub_data).to have_key("organization_name")
        expect(hub_data).to have_key("created_at")
        expect(hub_data).to have_key("users_count")
        expect(hub_data).to have_key("active_external_users_count")
        expect(hub_data).to have_key("max_messages")
        expect(hub_data).to have_key("sources_count")
        expect(hub_data).to have_key("max_sources")
        expect(hub_data).to have_key("documents_count")
        expect(hub_data).to have_key("max_documents")
        expect(hub_data).to have_key("trial_ends_at")
        expect(hub_data).to have_key("deletion_requested_at")
      end

      it "returns plan limits from custom_limits for enterprise hubs" do
        hub = create(:hub, plan: :enterprise, custom_limits: {"sources" => 10, "documents" => 5000, "messages" => 50000})
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["max_sources"]).to eq(10)
        expect(hub_data["max_documents"]).to eq(5000)
        expect(hub_data["max_messages"]).to eq(50000)
      end

      it "returns nil limits for enterprise hubs without custom_limits" do
        hub = create(:hub, plan: :enterprise, custom_limits: nil)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["max_sources"]).to be_nil
        expect(hub_data["max_documents"]).to be_nil
        expect(hub_data["max_messages"]).to be_nil
      end

      it "returns the raw custom_limits hash for enterprise hubs" do
        hub = create(:hub, plan: :enterprise, custom_limits: {"sources" => 10, "documents" => 5000, "messages" => 50000})
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["custom_limits"]).to eq("sources" => 10, "documents" => 5000, "messages" => 50000)
      end

      it "returns null for custom_limits when not set" do
        hub = create(:hub, plan: :enterprise, custom_limits: nil)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["custom_limits"]).to be_nil
      end

      it "counts only active external users from the last 30 days" do
        hub = create(:hub, plan: :standard)
        create(:external_user, hub: hub, external_id: "active_user", last_message_at: 1.day.ago)
        create(:external_user, hub: hub, external_id: "inactive_user", last_message_at: 31.days.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["active_external_users_count"]).to eq(1)
      end

      it "counts sources belonging to the hub" do
        hub = create(:hub, plan: :standard)
        create_list(:source, 2, hub: hub)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["sources_count"]).to eq(2)
      end

      it "counts documents belonging to the hub's sources" do
        hub = create(:hub, plan: :standard)
        source = create(:source, hub: hub)
        create_list(:document, 4, source: source)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data["documents_count"]).to eq(4)
      end

      it "includes conversation timestamps for hubs with conversations" do
        hub = create(:hub, plan: :standard)
        internal_conv = create(:conversation, hub: hub, platform: :internal)
        external_conv = create(:conversation, :external, hub: hub)
        internal_conv.update_column(:updated_at, 3.days.ago)
        external_conv.update_column(:updated_at, 1.day.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs", headers: headers

        json = JSON.parse(response.body)
        hub_data = json.find { |h| h["id"] == hub.id }
        expect(hub_data).to have_key("last_internal_conversation_at")
        expect(hub_data).to have_key("last_external_conversation_at")
        expect(hub_data["last_internal_conversation_at"]).not_to be_nil
        expect(hub_data["last_external_conversation_at"]).not_to be_nil
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/hubs", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)).to have_key("error")
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/hubs"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/hubs/:id/memberships" do
    context "when user is a super admin" do
      it "returns hub memberships with user details and covers conversation aggregation in hub_aggregates" do
        # Create hub with conversations to ensure lines 193-194 are covered when hub_aggregates is called
        hub = create(:hub)
        internal_conv = create(:conversation, hub: hub, platform: :internal)
        external_conv = create(:conversation, :external, hub: hub)
        internal_conv.update_column(:updated_at, 3.days.ago)
        external_conv.update_column(:updated_at, 1.day.ago)

        # Create memberships to cover lines 17-20 (hub_memberships endpoint)
        user1 = create(:user, name: "Alice", email: "alice@example.com")
        user2 = create(:user, name: "Bob", email: "bob@example.com")
        membership1 = create(:hub_membership, hub: hub, user: user1, role: "admin", approved: true)
        membership2 = create(:hub_membership, hub: hub, user: user2, role: "editor", approved: false)

        headers = auth_headers_for(super_admin)

        # First call hub_memberships endpoint to cover lines 17-20
        get "/api/admin/hubs/#{hub.id}/memberships", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to be_an(Array)
        expect(json.length).to eq(2)

        # Verify the first membership (unapproved should come first due to sorting)
        unapproved = json.find { |m| m["id"] == membership2.id }
        expect(unapproved).to include(
          "id" => membership2.id,
          "role" => "editor",
          "approved" => false
        )
        expect(unapproved["user"]).to include(
          "id" => user2.id,
          "name" => "Bob",
          "email" => "bob@example.com",
          "confirmed" => true
        )
        expect(unapproved["user"]).to have_key("profile_picture_url")
        expect(unapproved["user"]).to have_key("created_at")

        # Verify the second membership
        approved = json.find { |m| m["id"] == membership1.id }
        expect(approved).to include(
          "id" => membership1.id,
          "role" => "admin",
          "approved" => true
        )

        # Now call the hubs endpoint to cover lines 193-194 (hub_aggregates conversation handling)
        get "/api/admin/hubs", headers: headers

        expect(response).to have_http_status(:ok)
        hubs_json = JSON.parse(response.body)
        hub_data = hubs_json.find { |h| h["id"] == hub.id }
        expect(hub_data).to have_key("last_internal_conversation_at")
        expect(hub_data).to have_key("last_external_conversation_at")
        expect(hub_data["last_internal_conversation_at"]).not_to be_nil
        expect(hub_data["last_external_conversation_at"]).not_to be_nil
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}/memberships", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}/memberships"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/hubs/:id/activity" do
    context "when user is a super admin" do
      it "returns the hub's lifecycle events" do
        hub = create(:hub, plan: :standard)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}/activity", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to be_an(Array)
        expect(json.map { |event| event["type"] }).to include("hub_created")
      end

      it "returns 404 when the hub does not exist" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/999999/activity", headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}/activity", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}/activity"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/hubs/:id" do
    context "when user is a super admin" do
      it "returns hub data with the expected fields including conversation timestamps" do
        hub = create(:hub, plan: :standard)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to include(
          "id" => hub.id,
          "name" => hub.name,
          "plan" => "standard"
        )
        expect(json).to have_key("last_internal_conversation_at")
        expect(json).to have_key("last_external_conversation_at")
      end

      it "returns null timestamps when the hub has no conversations" do
        hub = create(:hub)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}", headers: headers

        json = JSON.parse(response.body)
        expect(json["last_internal_conversation_at"]).to be_nil
        expect(json["last_external_conversation_at"]).to be_nil
      end

      it "returns the most recent internal conversation timestamp" do
        hub = create(:hub)
        older = create(:conversation, hub: hub)
        newer = create(:conversation, hub: hub)
        older.update_column(:updated_at, 2.days.ago)
        newer.update_column(:updated_at, 1.hour.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}", headers: headers

        json = JSON.parse(response.body)
        expect(Time.parse(json["last_internal_conversation_at"])).to be_within(1.second).of(newer.reload.updated_at)
      end

      it "returns the most recent external conversation timestamp" do
        hub = create(:hub)
        older = create(:conversation, :external, hub: hub)
        newer = create(:conversation, :external, hub: hub)
        older.update_column(:updated_at, 2.days.ago)
        newer.update_column(:updated_at, 1.hour.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}", headers: headers

        json = JSON.parse(response.body)
        expect(Time.parse(json["last_external_conversation_at"])).to be_within(1.second).of(newer.reload.updated_at)
      end

      it "does not mix internal and external conversation timestamps" do
        hub = create(:hub)
        internal_conv = create(:conversation, hub: hub)
        external_conv = create(:conversation, :external, hub: hub)
        internal_conv.update_column(:updated_at, 2.days.ago)
        external_conv.update_column(:updated_at, 1.hour.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}", headers: headers

        json = JSON.parse(response.body)
        expect(Time.parse(json["last_internal_conversation_at"])).to be_within(1.second).of(internal_conv.reload.updated_at)
        expect(Time.parse(json["last_external_conversation_at"])).to be_within(1.second).of(external_conv.reload.updated_at)
      end

      it "returns 404 when the hub does not exist" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/999999", headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        hub = create(:hub)

        get "/api/admin/hubs/#{hub.id}"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/export/hubs" do
    context "when user is a super admin" do
      it "returns a CSV file with the correct content type and filename" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/hubs", headers: headers

        expect(response).to have_http_status(:ok)
        expect(response.content_type).to eq("text/csv")
        expect(response.headers["Content-Disposition"]).to include("attachment")
        expect(response.headers["Content-Disposition"]).to match(/suwali-hubs-export-\d{4}-\d{2}-\d{2}\.csv/)
      end

      it "returns CSV with the expected column headers" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/hubs", headers: headers

        csv = CSV.parse(response.body)
        expect(csv.first).to eq([
          "ID", "Name", "Organization Name", "Plan",
          "Trial Active", "Trial Expired", "Trial Ends At", "Invite Code",
          "Created At", "Editors Count", "Active Users", "Max Messages",
          "Sources Count", "Max Sources", "Documents Count", "Max Documents"
        ])
      end

      it "includes hub data rows" do
        hub = create(:hub, plan: :standard)
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/hubs", headers: headers

        csv = CSV.parse(response.body)
        hub_row = csv.find { |row| row[0] == hub.id.to_s }
        expect(hub_row).not_to be_nil
        expect(hub_row[1]).to eq(hub.name)
        expect(hub_row[3]).to eq("standard")
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/export/hubs", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/export/hubs"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/export/message-reports" do
    context "when user is a super admin" do
      it "returns a CSV file with the correct content type and filename" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/message-reports", headers: headers

        expect(response).to have_http_status(:ok)
        expect(response.content_type).to eq("text/csv")
        expect(response.headers["Content-Disposition"]).to include("attachment")
        expect(response.headers["Content-Disposition"]).to match(/suwali-message-reports-export-\d{4}-\d{2}-\d{2}\.csv/)
      end

      it "returns CSV with the expected column headers" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/message-reports", headers: headers

        csv = CSV.parse(response.body)
        expect(csv.first).to eq([
          "ID", "Hub ID", "Hub Name", "Message ID", "Message Link", "Platform", "User Question",
          "Message Body", "Message Sent At", "Reported By Email", "Comment", "Created At"
        ])
      end

      it "includes the platform, the user's question and when the message was sent" do
        conversation = create(:conversation, :external)
        question = create(:message, conversation: conversation, direction: "incoming", body: "What is the deadline?")
        answer = create(:message, conversation: conversation, direction: "outgoing", reply_to: question)
        report = create(:message_report, message: answer)

        get "/api/admin/export/message-reports", headers: auth_headers_for(super_admin)

        row = CSV.parse(response.body, headers: true).find { |r| r["ID"] == report.id.to_s }
        expect(row["Platform"]).to eq("telegram")
        expect(row["User Question"]).to eq("What is the deadline?")
        expect(row["Message Sent At"]).to eq(answer.created_at.iso8601)
      end

      it "lists the newest reports first, like the table" do
        older = create(:message_report, message: create(:message, direction: "outgoing"))
        newer = create(:message_report, message: create(:message, direction: "outgoing"))

        get "/api/admin/export/message-reports", headers: auth_headers_for(super_admin)

        ids = CSV.parse(response.body, headers: true).map { |row| row["ID"].to_i }
        expect(ids.index(newer.id)).to be < ids.index(older.id)
      end

      it "includes message report data rows" do
        message = create(:message, direction: "outgoing")
        report = create(:message_report, message: message)
        headers = auth_headers_for(super_admin)

        get "/api/admin/export/message-reports", headers: headers

        csv = CSV.parse(response.body)
        report_row = csv.find { |row| row[0] == report.id.to_s }
        expect(report_row).not_to be_nil
        expect(report_row[3]).to eq(message.id.to_s)
      end

      it "links to the view any hub member can open, based on the conversation's platform" do
        team_conversation = create(:conversation)
        audience_conversation = create(:conversation, :external)
        team_message = create(:message, conversation: team_conversation, direction: "outgoing")
        audience_message = create(:message, conversation: audience_conversation, direction: "outgoing")
        create(:message_report, message: team_message)
        create(:message_report, message: audience_message)

        get "/api/admin/export/message-reports", headers: auth_headers_for(super_admin)

        links = CSV.parse(response.body, headers: true).map { |row| row["Message Link"] }
        expect(links).to include(
          a_string_ending_with("/hub/#{team_conversation.hub_id}/conversations/team/#{team_conversation.id}?platforms=any&messageId=#{team_message.id}"),
          a_string_ending_with("/hub/#{audience_conversation.hub_id}/conversations/audience/#{audience_conversation.id}?platforms=any&messageId=#{audience_message.id}")
        )
      end

      it "only exports the reports of the given hub" do
        report = create(:message_report, message: create(:message, direction: "outgoing"))
        other_report = create(:message_report, message: create(:message, direction: "outgoing"))
        hub_id = report.message.conversation.hub_id

        get "/api/admin/export/message-reports", params: {hub_id: hub_id}, headers: auth_headers_for(super_admin)

        expect(response.headers["Content-Disposition"]).to match(/suwali-message-reports-export-hub-#{hub_id}-\d{4}-\d{2}-\d{2}\.csv/)
        ids = CSV.parse(response.body, headers: true).map { |row| row["ID"] }
        expect(ids).to include(report.id.to_s)
        expect(ids).not_to include(other_report.id.to_s)
      end

      it "returns not found for an unknown hub" do
        get "/api/admin/export/message-reports", params: {hub_id: 0}, headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/export/message-reports", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/export/message-reports"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/message-reports" do
    context "when user is a super admin" do
      it "returns the reports with the question, hub and reporter, newest first" do
        conversation = create(:conversation, :external)
        question = create(:message, conversation: conversation, direction: "incoming", body: "What is the deadline?")
        answer = create(:message, conversation: conversation, direction: "outgoing", reply_to: question)
        older = create(:message_report, message: create(:message, direction: "outgoing"))
        report = create(:message_report, message: answer, comment: "Wrong date")

        get "/api/admin/message-reports", headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["data"].first(2).map { |r| r["id"] }).to eq([report.id, older.id])
        expect(json["data"].first).to include(
          "hub_id" => conversation.hub_id,
          "hub_name" => conversation.hub.name,
          "message_id" => answer.id,
          "message_link" => answer.permalink,
          "message_sent_at" => answer.created_at.iso8601,
          "platform" => "telegram",
          "user_question" => "What is the deadline?",
          "message_body" => answer.body,
          "reported_by_email" => report.reported_by.email,
          "comment" => "Wrong date"
        )
      end

      it "paginates" do
        create_list(:message_report, 3, message: create(:message, direction: "outgoing"))

        get "/api/admin/message-reports", params: {page: 2, per_page: 2}, headers: auth_headers_for(super_admin)

        json = JSON.parse(response.body)
        expect(json["pagination"]).to include("current_page" => 2, "per_page" => 2, "total_pages" => 2, "total_count" => 3)
        expect(json["data"].size).to eq(1)
      end

      it "only returns the reports of the given hub" do
        report = create(:message_report, message: create(:message, direction: "outgoing"))
        other_report = create(:message_report, message: create(:message, direction: "outgoing"))

        get "/api/admin/message-reports", params: {hub_id: report.message.conversation.hub_id}, headers: auth_headers_for(super_admin)

        ids = JSON.parse(response.body)["data"].map { |r| r["id"] }
        expect(ids).to include(report.id)
        expect(ids).not_to include(other_report.id)
      end

      it "returns not found for an unknown hub" do
        get "/api/admin/message-reports", params: {hub_id: 0}, headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/message-reports", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/message-reports"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/health" do
    context "when user is a super admin" do
      it "returns health status with Sidekiq and Knowledge Service metrics" do
        headers = auth_headers_for(super_admin)

        # Mock Sidekiq metrics
        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 50)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

        queue = double(name: "default", size: 50, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        # Mock Knowledge Service
        allow(KnowledgeService).to receive(:health).and_return(
          {
            "status" => "ok",
            "enqueued_jobs" => 25,
            "failed_jobs" => 5,
            "active_workers" => 2
          }
        )

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)

        expect(json["status"]).to eq("ok")
        expect(json["sidekiq"]).to include(
          "processed" => 1000,
          "failed" => 10,
          "enqueued" => 50,
          "retry_size" => 5,
          "dead_size" => 2,
          "processes" => 3
        )
        expect(json["sidekiq"]["queues"]).to be_an(Array)
        expect(json["sidekiq"]["queues"].first).to include(
          "name" => "default",
          "size" => 50,
          "latency" => 100
        )
        expect(json["knowledge_service_rq"]).to include(
          "status" => "ok",
          "enqueued_jobs" => 25,
          "failed_jobs" => 5,
          "active_workers" => 2
        )
      end

      it "returns warning status when Sidekiq queue is backed up" do
        headers = auth_headers_for(super_admin)

        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 1500)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

        queue = double(name: "default", size: 1500, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        allow(KnowledgeService).to receive(:health).and_return(
          {"status" => "ok", "enqueued_jobs" => 25, "failed_jobs" => 5, "active_workers" => 2}
        )

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(503)
        expect(JSON.parse(response.body)["status"]).to eq("warning")
      end

      it "returns warning status when Knowledge Service queue is backed up" do
        headers = auth_headers_for(super_admin)

        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 50)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

        queue = double(name: "default", size: 50, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        allow(KnowledgeService).to receive(:health).and_return(
          {"status" => "ok", "enqueued_jobs" => 1500, "failed_jobs" => 5, "active_workers" => 2}
        )

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(503)
        expect(JSON.parse(response.body)["status"]).to eq("warning")
      end

      it "returns warning status when no Sidekiq processes are running" do
        headers = auth_headers_for(super_admin)

        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 50)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 0))

        queue = double(name: "default", size: 50, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        allow(KnowledgeService).to receive(:health).and_return(
          {"status" => "ok", "enqueued_jobs" => 25, "failed_jobs" => 5, "active_workers" => 2}
        )

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(503)
        expect(JSON.parse(response.body)["status"]).to eq("warning")
      end

      it "returns warning status when Knowledge Service has no active workers" do
        headers = auth_headers_for(super_admin)

        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 50)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

        queue = double(name: "default", size: 50, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        allow(KnowledgeService).to receive(:health).and_return(
          {"status" => "ok", "enqueued_jobs" => 25, "failed_jobs" => 5, "active_workers" => 0}
        )

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(503)
        expect(JSON.parse(response.body)["status"]).to eq("warning")
      end

      it "handles Knowledge Service errors gracefully" do
        headers = auth_headers_for(super_admin)

        allow(Sidekiq::Stats).to receive(:new).and_return(
          double(processed: 1000, failed: 10, enqueued: 50)
        )
        allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
        allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
        allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

        queue = double(name: "default", size: 50, latency: 100)
        allow(Sidekiq::Queue).to receive(:all).and_return([queue])

        allow(KnowledgeService).to receive(:health).and_raise(KnowledgeService::Error.new("Connection failed"))

        get "/api/admin/health", headers: headers

        expect(response).to have_http_status(503)
        json = JSON.parse(response.body)
        expect(json["status"]).to eq("warning")
        expect(json["knowledge_service_rq"]["error"]).to eq("Connection failed")
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/health", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)).to have_key("error")
      end
    end
  end

  describe "GET /api/admin/users/unconfirmed" do
    context "when user is a super admin" do
      it "returns users who have not confirmed their email" do
        unconfirmed = create(:user, confirmed_at: nil)
        confirmed = create(:user, confirmed_at: Time.current)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/unconfirmed", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        emails = json.map { |u| u["email"] }
        expect(emails).to include(unconfirmed.email)
        expect(emails).not_to include(confirmed.email)
      end

      it "includes email, hub_name, and created_at in each row" do
        create(:user, confirmed_at: nil)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/unconfirmed", headers: headers

        json = JSON.parse(response.body)
        row = json.first
        expect(row).to have_key("email")
        expect(row).to have_key("hub_name")
        expect(row).to have_key("created_at")
      end

      it "includes hub name when an unconfirmed user has a hub membership" do
        user = create(:user, confirmed_at: nil)
        hub = create(:hub, name: "Onboarding Hub")
        create(:hub_membership, user: user, hub: hub)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/unconfirmed", headers: headers

        json = JSON.parse(response.body)
        row = json.find { |u| u["email"] == user.email }
        expect(row["hub_name"]).to eq("Onboarding Hub")
      end

      it "returns one row per hub membership for unconfirmed users with multiple hubs" do
        user = create(:user, confirmed_at: nil)
        create(:hub_membership, user: user, hub: create(:hub))
        create(:hub_membership, user: user, hub: create(:hub))
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/unconfirmed", headers: headers

        json = JSON.parse(response.body)
        rows = json.select { |u| u["email"] == user.email }
        expect(rows.length).to eq(2)
      end

      it "returns a null hub_name for unconfirmed users with no hub membership" do
        user = create(:user, confirmed_at: nil)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/unconfirmed", headers: headers

        json = JSON.parse(response.body)
        row = json.find { |u| u["email"] == user.email }
        expect(row["hub_name"]).to be_nil
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/users/unconfirmed", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/users/unconfirmed"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/users/no-hub" do
    context "when user is a super admin" do
      it "returns users who are not a member of any hub" do
        no_hub_user = create(:user)
        hub_user = create(:user)
        hub = create(:hub)
        create(:hub_membership, user: hub_user, hub: hub, approved: true)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/no-hub", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        emails = json.map { |u| u["email"] }
        expect(emails).to include(no_hub_user.email)
        expect(emails).not_to include(hub_user.email)
      end

      it "includes email, hub_name, and created_at in each row" do
        create(:user)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/no-hub", headers: headers

        json = JSON.parse(response.body)
        row = json.first
        expect(row).to have_key("email")
        expect(row).to have_key("hub_name")
        expect(row).to have_key("created_at")
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/users/no-hub", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/users/no-hub"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/users/inactive" do
    let(:hub) { create(:hub, name: "Quiet Hub") }
    let(:long_ago) { (User::INACTIVITY_THRESHOLD + 1.day).ago }

    def inactive_editor(attrs = {})
      user = create(:user, {last_active_at: long_ago, confirmed_at: 1.year.ago}.merge(attrs))
      create(:hub_membership, user: user, hub: hub, approved: true)
      user
    end

    context "when user is a super admin" do
      it "returns confirmed hub editors who have not been active within the threshold" do
        inactive = inactive_editor
        active = create(:user, last_active_at: 1.day.ago, confirmed_at: 1.year.ago)
        create(:hub_membership, user: active, hub: hub, approved: true)

        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        emails = json["users"].map { |u| u["email"] }
        expect(emails).to include(inactive.email)
        expect(emails).not_to include(active.email)
      end

      it "ignores unapproved memberships, which never made the user an editor of that hub" do
        pending_only = create(:user, last_active_at: long_ago, confirmed_at: 1.year.ago)
        create(:hub_membership, user: pending_only, hub: hub, approved: false)

        editor = inactive_editor
        create(:hub_membership, user: editor, hub: create(:hub, name: "Not Approved Hub"), approved: false)

        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        rows = JSON.parse(response.body)["users"]
        expect(rows.map { |u| u["email"] }).not_to include(pending_only.email)
        expect(rows.select { |u| u["email"] == editor.email }.map { |u| u["hub_name"] }).to eq(["Quiet Hub"])
      end

      it "reports the threshold so the dashboard does not hardcode it" do
        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        expect(JSON.parse(response.body)["threshold_days"]).to eq(User::INACTIVITY_THRESHOLD.in_days.to_i)
      end

      it "excludes unconfirmed users and users with no hub" do
        unconfirmed = inactive_editor(confirmed_at: nil)
        no_hub = create(:user, last_active_at: long_ago, confirmed_at: 1.year.ago)

        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        emails = JSON.parse(response.body)["users"].map { |u| u["email"] }
        expect(emails).not_to include(unconfirmed.email)
        expect(emails).not_to include(no_hub.email)
      end

      it "includes the hub and the activity timestamps in each row" do
        user = inactive_editor(last_login_at: long_ago)

        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        row = JSON.parse(response.body)["users"].find { |u| u["email"] == user.email }
        expect(row["hub_name"]).to eq("Quiet Hub")
        expect(row["hub_id"]).to eq(hub.id)
        expect(row["last_login_at"]).to be_present
        expect(row["last_active_at"]).to be_present
      end

      it "lists the longest-inactive editor first" do
        recent = inactive_editor(last_active_at: (User::INACTIVITY_THRESHOLD + 1.day).ago)
        oldest = inactive_editor(last_active_at: (User::INACTIVITY_THRESHOLD + 90.days).ago)

        get "/api/admin/users/inactive", headers: auth_headers_for(super_admin)

        emails = JSON.parse(response.body)["users"].map { |u| u["email"] }
        expect(emails.index(oldest.email)).to be < emails.index(recent.email)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/users/inactive", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/users/inactive"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/users/pending-approval" do
    context "when user is a super admin" do
      it "returns users with unapproved hub memberships" do
        pending_user = create(:user)
        approved_user = create(:user)
        hub = create(:hub)
        create(:hub_membership, user: pending_user, hub: hub, approved: false)
        create(:hub_membership, user: approved_user, hub: hub, approved: true)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/pending-approval", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        emails = json.map { |u| u["email"] }
        expect(emails).to include(pending_user.email)
        expect(emails).not_to include(approved_user.email)
      end

      it "includes the hub name for each pending membership" do
        pending_user = create(:user)
        hub = create(:hub, name: "Support Hub")
        create(:hub_membership, user: pending_user, hub: hub, approved: false)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/pending-approval", headers: headers

        json = JSON.parse(response.body)
        row = json.find { |u| u["email"] == pending_user.email }
        expect(row["hub_name"]).to eq("Support Hub")
      end

      it "returns one row per pending membership when a user has multiple" do
        pending_user = create(:user)
        create(:hub_membership, user: pending_user, hub: create(:hub), approved: false)
        create(:hub_membership, user: pending_user, hub: create(:hub), approved: false)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/pending-approval", headers: headers

        json = JSON.parse(response.body)
        rows = json.select { |u| u["email"] == pending_user.email }
        expect(rows.length).to eq(2)
      end

      it "includes requested_at from the membership creation date" do
        pending_user = create(:user)
        hub = create(:hub)
        create(:hub_membership, user: pending_user, hub: hub, approved: false)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/pending-approval", headers: headers

        json = JSON.parse(response.body)
        row = json.find { |u| u["email"] == pending_user.email }
        expect(row).to have_key("requested_at")
        expect(row["requested_at"]).not_to be_nil
      end

      it "returns rows sorted by membership creation date ascending" do
        older_user = create(:user)
        newer_user = create(:user)
        hub = create(:hub)
        create(:hub_membership, user: newer_user, hub: hub, approved: false, created_at: 1.day.ago)
        create(:hub_membership, user: older_user, hub: hub, approved: false, created_at: 10.days.ago)
        headers = auth_headers_for(super_admin)

        get "/api/admin/users/pending-approval", headers: headers

        json = JSON.parse(response.body)
        emails = json.map { |u| u["email"] }
        expect(emails.index(older_user.email)).to be < emails.index(newer_user.email)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/users/pending-approval", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/users/pending-approval"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "PATCH /api/admin/hubs/:id" do
    context "when user is a write super admin" do
      let(:headers) { auth_headers_for(write_admin) }

      it "updates the plan between two premium plans" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}", params: {hub: {plan: "standard"}}, headers: headers

        expect(response).to have_http_status(:ok)
        expect(JSON.parse(response.body)["plan"]).to eq("standard")
        expect(hub.reload.plan).to eq("standard")
      end

      it "updates plan to premium and clears trial dates together" do
        hub = create(:hub, plan: :free)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {plan: "enterprise", trial_started_at: "", trial_ends_at: ""}},
          headers: headers

        expect(response).to have_http_status(:ok)
        expect(hub.reload.plan).to eq("enterprise")
        expect(hub.reload.trial_started_at).to be_nil
        expect(hub.reload.trial_ends_at).to be_nil
      end

      it "updates trial dates with valid YYYY-MM-DD format" do
        hub = create(:hub, plan: :free)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {trial_started_at: "2026-01-01", trial_ends_at: "2026-07-01"}},
          headers: headers

        expect(response).to have_http_status(:ok)
        expect(hub.reload.trial_started_at.to_date).to eq(Date.new(2026, 1, 1))
        expect(hub.reload.trial_ends_at.to_date).to eq(Date.new(2026, 7, 1))
      end

      it "updates custom_limits for an enterprise hub" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {custom_limits: {sources: 20, messages: 5000, documents: 2000}}},
          headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["max_sources"]).to eq(20)
        expect(json["max_documents"]).to eq(2000)
        expect(json["max_messages"]).to eq(5000)
        reloaded = hub.reload
        expect(reloaded.custom_limits["sources"]).to eq(20)
        expect(reloaded.custom_limits["documents"]).to eq(2000)
        expect(reloaded.custom_limits["messages"]).to eq(5000)
      end

      it "returns the hub_row shape in the response" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}", params: {hub: {plan: "standard"}}, headers: headers

        json = JSON.parse(response.body)
        expect(json).to include("id" => hub.id, "name" => hub.name, "plan" => "standard")
        expect(json).to have_key("sources_count")
        expect(json).to have_key("max_sources")
        expect(json).to have_key("documents_count")
        expect(json).to have_key("max_documents")
        expect(json).to have_key("last_internal_conversation_at")
        expect(json).to have_key("last_external_conversation_at")
      end

      it "silently drops unpermitted keys in custom_limits" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {custom_limits: {sources: 10, forbidden_key: 999}}},
          headers: headers

        expect(response).to have_http_status(:ok)
        expect(hub.reload.custom_limits).not_to have_key("forbidden_key")
        expect(hub.reload.custom_limits["sources"]).to eq(10)
      end

      it "returns 422 for an invalid plan value" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}", params: {hub: {plan: "galaxy_brain"}}, headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).not_to be_empty
      end

      it "returns 422 when a trial date is not in YYYY-MM-DD format" do
        hub = create(:hub, plan: :free)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {trial_started_at: "January 1st 2026", trial_ends_at: "2026-07-01"}},
          headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_hub_invalid_date_format))
      end

      it "returns 422 when a custom_limits value is not a non-negative integer" do
        hub = create(:hub, plan: :enterprise)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {custom_limits: {sources: "many"}}},
          headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["errors"]).to include(I18n.t(:error_hub_invalid_custom_limit, key: "sources"))
      end

      it "returns 422 when model validations fail" do
        hub = create(:hub, plan: :free)

        # Providing inconsistent trial dates fails the model validation
        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {trial_started_at: "2025-01-10", trial_ends_at: "2025-01-01"}},
          headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)).to have_key("errors")
      end

      it "returns 404 when hub does not exist" do
        patch "/api/admin/hubs/999999", params: {hub: {plan: "enterprise"}}, headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is a read-only super admin (no write access flag)" do
      it "returns forbidden" do
        hub = create(:hub)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {plan: "standard"}},
          headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)).to have_key("error")
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        hub = create(:hub)

        patch "/api/admin/hubs/#{hub.id}",
          params: {hub: {plan: "standard"}},
          headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
        expect(JSON.parse(response.body)).to have_key("error")
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        hub = create(:hub)

        patch "/api/admin/hubs/#{hub.id}", params: {hub: {plan: "standard"}}

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "DELETE /api/admin/hubs/:id" do
    context "when user is a write super admin" do
      it "flags the hub for deletion and enqueues the deletion worker" do
        hub = create(:hub, plan: :free)
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/hubs/#{hub.id}", headers: headers
        }.to change(HubDeletionWorker.jobs, :size).by(1)

        expect(response).to have_http_status(:accepted)
        json = JSON.parse(response.body)
        expect(json["message"]).to eq(I18n.t(:message_hub_deletion_scheduled))
        expect(HubDeletionWorker.jobs.last["args"]).to eq([hub.id])

        hub.reload
        expect(hub.deletion_requested_at).to be_present
        expect(hub.deletion_requested_by_email).to eq(write_admin.email)
      end

      it "does not destroy the hub synchronously" do
        hub = create(:hub, plan: :free)
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/hubs/#{hub.id}", headers: headers
        }.not_to change(Hub, :count)
      end

      it "does not overwrite the audit trail when the hub is already flagged, but still enqueues a retry" do
        original_requested_at = 1.hour.ago.change(usec: 0)
        hub = create(:hub, plan: :free)
        hub.update_columns(deletion_requested_at: original_requested_at, deletion_requested_by_email: "first@meedan.com")
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/hubs/#{hub.id}", headers: headers
        }.to change(HubDeletionWorker.jobs, :size).by(1)

        expect(response).to have_http_status(:accepted)
        hub.reload
        expect(hub.deletion_requested_at).to eq(original_requested_at)
        expect(hub.deletion_requested_by_email).to eq("first@meedan.com")
      end

      it "flags free_unrestricted hubs" do
        hub = create(:hub, plan: :free_unrestricted)
        headers = auth_headers_for(write_admin)

        delete "/api/admin/hubs/#{hub.id}", headers: headers

        expect(response).to have_http_status(:accepted)
        expect(hub.reload.deletion_requested_at).to be_present
      end

      it "returns 422 for a premium hub" do
        hub = create(:hub, plan: :enterprise)
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/hubs/#{hub.id}", headers: headers
        }.not_to change(HubDeletionWorker.jobs, :size)

        expect(response).to have_http_status(:unprocessable_content)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_hub_deletion_not_free))
        expect(hub.reload.deletion_requested_at).to be_nil
      end

      it "returns 404 when the hub does not exist" do
        headers = auth_headers_for(write_admin)

        delete "/api/admin/hubs/0", headers: headers

        expect(response).to have_http_status(:not_found)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_not_found))
      end
    end

    context "when user is a read-only super admin (no write access flag)" do
      it "returns 403 forbidden" do
        hub = create(:hub, plan: :free)

        expect {
          delete "/api/admin/hubs/#{hub.id}", headers: auth_headers_for(super_admin)
        }.not_to change(HubDeletionWorker.jobs, :size)

        expect(response).to have_http_status(:forbidden)
        expect(hub.reload.deletion_requested_at).to be_nil
      end
    end

    context "when user is not a super admin" do
      it "returns 403 forbidden" do
        hub = create(:hub, plan: :free)
        headers = auth_headers_for(regular_user)

        delete "/api/admin/hubs/#{hub.id}", headers: headers

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns 401 unauthorized" do
        hub = create(:hub, plan: :free)

        delete "/api/admin/hubs/#{hub.id}"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "DELETE /api/admin/users/:id" do
    context "when user is a write super admin" do
      it "deletes an unconfirmed user" do
        unconfirmed_user = create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current)
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/users/#{unconfirmed_user.id}", headers: headers
        }.to change(User, :count).by(-1)

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["message"]).to eq(I18n.t(:message_deleted))
      end

      it "deletes a confirmed user who is not a member of any hub" do
        hubless_user = create(:user)
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/users/#{hubless_user.id}", headers: headers
        }.to change(User, :count).by(-1)

        expect(response).to have_http_status(:ok)
      end

      it "returns 422 when the user is confirmed and a member of a hub" do
        member = create(:user)
        create(:hub_membership, user: member, hub: create(:hub))
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/users/#{member.id}", headers: headers
        }.not_to change(User, :count)

        expect(response).to have_http_status(:unprocessable_content)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_user_not_deletable))
      end

      it "returns 403 when deleting their own account" do
        headers = auth_headers_for(write_admin)

        expect {
          delete "/api/admin/users/#{write_admin.id}", headers: headers
        }.not_to change(User, :count)

        expect(response).to have_http_status(:forbidden)
      end

      it "returns 404 when the user does not exist" do
        headers = auth_headers_for(write_admin)

        delete "/api/admin/users/0", headers: headers

        expect(response).to have_http_status(:not_found)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_not_found))
      end
    end

    context "when user is a read-only super admin (no write access flag)" do
      it "returns 403 forbidden" do
        unconfirmed_user = create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current)

        delete "/api/admin/users/#{unconfirmed_user.id}", headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not a super admin" do
      it "returns 403 forbidden" do
        unconfirmed_user = create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current)
        headers = auth_headers_for(regular_user)

        delete "/api/admin/users/#{unconfirmed_user.id}", headers: headers

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns 401 unauthorized" do
        unconfirmed_user = create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current)

        delete "/api/admin/users/#{unconfirmed_user.id}"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "PATCH /api/admin/users/:id/move-to-hub" do
    let(:stray_hub) { create(:hub, plan: :free) }
    let(:target_hub) { create(:hub) }
    let(:user) { create(:user) }

    before do
      create(:hub_membership, hub: target_hub, role: :admin)
      create(:hub_membership, hub: stray_hub, user: user, role: :admin)
    end

    context "when user is a write super admin" do
      it "moves the user as a pending editor by default" do
        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id}, headers: auth_headers_for(write_admin)

        expect(response).to have_http_status(:ok)
        expect(user.hub_memberships.map { |m| [m.hub_id, m.role, m.approved] }).to eq([[target_hub.id, "editor", false]])
      end

      it "approves the membership right away when asked to" do
        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id, approved: true}, headers: auth_headers_for(write_admin)

        expect(response).to have_http_status(:ok)
        expect(user.hub_memberships.sole.approved).to be(true)
      end

      it "returns 422 when the user's hub has other members" do
        create(:hub_membership, hub: stray_hub)

        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id}, headers: auth_headers_for(write_admin)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["error"]).to eq(I18n.t(:error_user_not_movable))
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end

      it "returns 422 when the target hub is an expired trial due for deletion" do
        target_hub.update!(plan: :free, trial_started_at: 3.months.ago, trial_ends_at: 2.months.ago)

        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id}, headers: auth_headers_for(write_admin)

        expect(response).to have_http_status(:unprocessable_content)
        expect(JSON.parse(response.body)["error"]).to eq(I18n.t(:error_hub_deletion_scheduled))
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end

      it "returns 422 when the user's hub is not a free trial" do
        stray_hub.update!(plan: :standard)

        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id}, headers: auth_headers_for(write_admin)

        expect(response).to have_http_status(:unprocessable_content)
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end
    end

    context "when user is a read-only super admin" do
      it "returns 403 forbidden" do
        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id}, headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:forbidden)
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end
    end

    context "when user is not a super admin" do
      it "returns 403 forbidden, even for an admin of the target hub" do
        target_hub_admin = target_hub.admins.first

        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id, approved: true}, headers: auth_headers_for(target_hub_admin)

        expect(response).to have_http_status(:forbidden)
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end

      it "returns 403 forbidden when the user tries to move themselves" do
        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id, approved: true}, headers: auth_headers_for(user)

        expect(response).to have_http_status(:forbidden)
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end
    end

    context "when user is not authenticated" do
      it "returns 401 unauthorized" do
        patch "/api/admin/users/#{user.id}/move-to-hub", params: {hub_id: target_hub.id, approved: true}

        expect(response).to have_http_status(:unauthorized)
        expect(user.hub_memberships.sole.hub_id).to eq(stray_hub.id)
      end
    end
  end

  describe "GET /api/admin/users/super-admins" do
    context "when user is a write super admin" do
      it "returns only confirmed Meedan email users" do
        confirmed_meedan = create(:user, email: "confirmed@meedan.com")
        create(:user, email: "unconfirmed@meedan.com", confirmed_at: nil)
        create(:user, email: "regular@example.com")
        headers = auth_headers_for(write_admin)

        get "/api/admin/users/super-admins", headers: headers

        expect(response).to have_http_status(:ok)
        emails = JSON.parse(response.body).map { |u| u["email"] }
        expect(emails).to include(confirmed_meedan.email, write_admin.email)
        expect(emails).not_to include("unconfirmed@meedan.com", "regular@example.com")
      end

      it "includes users from both meedan.com and meedan.org domains" do
        meedan_com = create(:user, email: "user@meedan.com")
        meedan_org = create(:user, email: "user@meedan.org")
        headers = auth_headers_for(write_admin)

        get "/api/admin/users/super-admins", headers: headers

        emails = JSON.parse(response.body).map { |u| u["email"] }
        expect(emails).to include(meedan_com.email, meedan_org.email)
      end

      it "returns the expected fields including admin_write_access" do
        read_only = create(:user, email: "readonly@meedan.com")
        write = create(:user, email: "write@meedan.com", admin_write_access: true)
        headers = auth_headers_for(write_admin)

        get "/api/admin/users/super-admins", headers: headers

        json = JSON.parse(response.body)
        read_only_entry = json.find { |u| u["email"] == read_only.email }
        write_entry = json.find { |u| u["email"] == write.email }

        expect(read_only_entry).to include("id" => read_only.id, "email" => read_only.email, "admin_write_access" => false)
        expect(read_only_entry).to have_key("created_at")
        expect(write_entry).to include("admin_write_access" => true)
      end

      it "returns users ordered by email" do
        create(:user, email: "zoe@meedan.com")
        create(:user, email: "alice@meedan.com")
        headers = auth_headers_for(write_admin)

        get "/api/admin/users/super-admins", headers: headers

        emails = JSON.parse(response.body).map { |u| u["email"] }
        expect(emails.index("alice@meedan.com")).to be < emails.index("zoe@meedan.com")
      end
    end

    context "when user is a read-only super admin" do
      it "returns 403 forbidden" do
        get "/api/admin/users/super-admins", headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not a super admin" do
      it "returns 403 forbidden" do
        get "/api/admin/users/super-admins", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns 401 unauthorized" do
        get "/api/admin/users/super-admins"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "PATCH /api/admin/users/:id/upgrade-to-write-admin" do
    context "when user is a write super admin" do
      it "sets admin_write_access to true on a read-only platform admin" do
        target = create(:user, email: "target@meedan.com", admin_write_access: false)
        headers = auth_headers_for(write_admin)

        patch "/api/admin/users/#{target.id}/upgrade-to-write-admin", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json["message"]).to eq(I18n.t(:message_upgraded))
        expect(target.reload.admin_write_access).to be(true)
      end

      it "returns 403 when the target user is not a Meedan email user" do
        non_admin = create(:user, email: "user@example.com")
        headers = auth_headers_for(write_admin)

        patch "/api/admin/users/#{non_admin.id}/upgrade-to-write-admin", headers: headers

        expect(response).to have_http_status(:forbidden)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_permission))
        expect(non_admin.reload.admin_write_access).to be(false)
      end

      it "returns 403 when the target is an unconfirmed Meedan email user" do
        unconfirmed = create(:user, email: "unconfirmed@meedan.com", confirmed_at: nil)
        headers = auth_headers_for(write_admin)

        patch "/api/admin/users/#{unconfirmed.id}/upgrade-to-write-admin", headers: headers

        expect(response).to have_http_status(:forbidden)
        expect(unconfirmed.reload.admin_write_access).to be(false)
      end

      it "returns 404 when the user does not exist" do
        headers = auth_headers_for(write_admin)

        patch "/api/admin/users/0/upgrade-to-write-admin", headers: headers

        expect(response).to have_http_status(:not_found)
        json = JSON.parse(response.body)
        expect(json["error"]).to eq(I18n.t(:error_not_found))
      end
    end

    context "when user is a read-only super admin" do
      it "returns 403 forbidden" do
        target = create(:user, email: "target@meedan.com")

        patch "/api/admin/users/#{target.id}/upgrade-to-write-admin", headers: auth_headers_for(super_admin)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not a super admin" do
      it "returns 403 forbidden" do
        target = create(:user, email: "target@meedan.com")

        patch "/api/admin/users/#{target.id}/upgrade-to-write-admin", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns 401 unauthorized" do
        target = create(:user, email: "target@meedan.com")

        patch "/api/admin/users/#{target.id}/upgrade-to-write-admin"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Admin API" do
  def hard_delete_hub!(hub_id)
    ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hub_memberships WHERE hub_id = ?", hub_id]))
    ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hubs WHERE id = ?", hub_id]))
  end

  path "/api/admin/hubs" do
    get "List all hubs with plan and usage data" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint to retrieve all hubs with their plan limits and current usage counts."

      response "200", "Hubs returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              id: {type: :integer},
              name: {type: :string},
              organization_name: {type: :string, nullable: true},
              plan: {type: :string},
              trial_active: {type: :boolean},
              trial_expired: {type: :boolean},
              trial_ends_at: {type: :string, nullable: true, format: "date-time"},
              invite_code: {type: :string, nullable: true},
              created_at: {type: :string, format: "date-time"},
              users_count: {type: :integer},
              active_external_users_count: {type: :integer},
              max_messages: {type: :integer, nullable: true},
              sources_count: {type: :integer},
              max_sources: {type: :integer, nullable: true},
              documents_count: {type: :integer},
              max_documents: {type: :integer, nullable: true}
            },
            required: %w[id name plan trial_active trial_expired created_at users_count
              active_external_users_count sources_count documents_count]
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(JSON.parse(response.body)).to be_an(Array)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/hubs/{id}" do
    get "Get a single hub with full detail and conversation activity" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint to retrieve a single hub with all plan/usage data and conversation activity timestamps."
      parameter name: :id, in: :path, type: :integer, required: true, description: "Hub ID"

      response "200", "Hub returned successfully" do
        schema type: :object,
          properties: {
            id: {type: :integer},
            name: {type: :string},
            organization_name: {type: :string, nullable: true},
            plan: {type: :string},
            trial_active: {type: :boolean},
            trial_expired: {type: :boolean},
            trial_ends_at: {type: :string, nullable: true, format: "date-time"},
            invite_code: {type: :string, nullable: true},
            created_at: {type: :string, format: "date-time"},
            users_count: {type: :integer},
            active_external_users_count: {type: :integer},
            max_messages: {type: :integer, nullable: true},
            sources_count: {type: :integer},
            max_sources: {type: :integer, nullable: true},
            documents_count: {type: :integer},
            max_documents: {type: :integer, nullable: true},
            last_internal_conversation_at: {type: :string, nullable: true, format: "date-time"},
            last_external_conversation_at: {type: :string, nullable: true, format: "date-time"}
          },
          required: %w[id name plan trial_active trial_expired created_at users_count
            active_external_users_count sources_count documents_count
            last_internal_conversation_at last_external_conversation_at]

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:id) { create(:hub).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to have_key("last_internal_conversation_at")
          expect(json).to have_key("last_external_conversation_at")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:hub).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { create(:hub).id }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end

  path "/api/admin/hubs/{id}/activity" do
    get "Get a hub's lifecycle activity timeline" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns a curated, chronological (newest first) timeline of one hub's key lifecycle events — creation, deletion, plan changes, deletion requests, editors added/removed, data sources added/removed, first document synced, messaging platforms connected/disconnected, trial start/end date edits, custom limit edits, feature flag changes, and trial email toggles — read from the audit log so it still covers history through a hub that has since been deleted."
      parameter name: :id, in: :path, type: :integer, required: true, description: "Hub ID"

      response "200", "Activity timeline returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              type: {type: :string},
              at: {type: :string, format: "date-time"},
              actor_email: {type: :string, nullable: true},
              detail: {type: :string, nullable: true},
              old_plan: {type: :string, nullable: true, description: "Only present on plan_changed events"},
              new_plan: {type: :string, nullable: true, description: "Only present on plan_changed events"}
            },
            required: %w[type at actor_email detail]
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:id) { create(:hub).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json.map { |event| event["type"] }).to include("hub_created")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:hub).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { create(:hub).id }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end

  path "/api/admin/export/hubs" do
    get "Export hubs as CSV" do
      tags "Admin"
      produces "text/csv"
      security [bearerAuth: []]
      description "Super admin only endpoint to export all hubs data as CSV."

      response "200", "CSV file generated successfully" do
        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(response.content_type).to eq("text/csv")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/export/message-reports" do
    get "Export message reports as CSV" do
      tags "Admin"
      produces "text/csv"
      security [bearerAuth: []]
      description "Super admin only endpoint to export all message reports as CSV."
      parameter name: :hub_id, in: :query, type: :integer, required: false, description: "Only export the reports of this hub"

      response "200", "CSV file generated successfully" do
        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(response.content_type).to eq("text/csv")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/message-reports" do
    get "List message reports" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint that returns a page of message reports, newest first."
      parameter name: :hub_id, in: :query, type: :integer, required: false, description: "Only return the reports of this hub"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number, starting at 1; defaults to the last page"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Reports per page, from 1 to 100 (default 100)"

      response "200", "Message reports returned successfully" do
        schema type: :object,
          properties: {
            data: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  id: {type: :integer},
                  hub_id: {type: :integer, nullable: true},
                  hub_name: {type: :string, nullable: true},
                  message_id: {type: :integer},
                  message_link: {type: :string, nullable: true},
                  platform: {type: :string, nullable: true},
                  user_question: {type: :string, nullable: true},
                  message_body: {type: :string, nullable: true},
                  message_sent_at: {type: :string, format: "date-time", nullable: true},
                  reported_by_email: {type: :string, nullable: true},
                  comment: {type: :string, nullable: true},
                  created_at: {type: :string, format: "date-time"}
                },
                required: %w[id hub_id hub_name message_id message_link platform user_question message_body message_sent_at reported_by_email comment created_at]
              }
            },
            pagination: {
              type: :object,
              properties: {
                current_page: {type: :integer},
                per_page: {type: :integer},
                total_pages: {type: :integer},
                total_count: {type: :integer}
              },
              required: %w[current_page per_page total_pages total_count]
            }
          },
          required: %w[data pagination]

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/users/unconfirmed" do
    get "List users who have not confirmed their email" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns internal users whose email confirmation is still pending."

      response "200", "Users returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              id: {type: :integer},
              email: {type: :string},
              hub_name: {type: :string, nullable: true},
              hub_id: {type: :integer, nullable: true},
              created_at: {type: :string, format: "date-time"},
              requested_at: {type: :string, format: "date-time", nullable: true},
              last_login_at: {type: :string, format: "date-time", nullable: true},
              last_active_at: {type: :string, format: "date-time", nullable: true}
            },
            required: %w[id email hub_name hub_id created_at requested_at last_login_at last_active_at]
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/users/no-hub" do
    get "List users who are not a member of any hub" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns internal users who have no hub membership."

      response "200", "Users returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              id: {type: :integer},
              email: {type: :string},
              hub_name: {type: :string, nullable: true},
              hub_id: {type: :integer, nullable: true},
              created_at: {type: :string, format: "date-time"},
              requested_at: {type: :string, format: "date-time", nullable: true},
              last_login_at: {type: :string, format: "date-time", nullable: true},
              last_active_at: {type: :string, format: "date-time", nullable: true}
            },
            required: %w[id email hub_name hub_id created_at requested_at last_login_at last_active_at]
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/users/inactive" do
    get "List hub editors who have not been active recently" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns confirmed users with an approved hub membership whose last activity is older than the platform inactivity threshold, one row per approved membership, longest inactive first. `threshold_days` reports the cutoff that was applied."

      response "200", "Users returned successfully" do
        schema type: :object,
          properties: {
            threshold_days: {type: :integer},
            users: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  id: {type: :integer},
                  email: {type: :string},
                  hub_name: {type: :string, nullable: true},
                  hub_id: {type: :integer, nullable: true},
                  created_at: {type: :string, format: "date-time"},
                  requested_at: {type: :string, format: "date-time", nullable: true},
                  last_login_at: {type: :string, format: "date-time", nullable: true},
                  last_active_at: {type: :string, format: "date-time", nullable: true}
                },
                required: %w[id email hub_name hub_id created_at requested_at last_login_at last_active_at]
              }
            }
          },
          required: %w[threshold_days users]

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/users/pending-approval" do
    get "List users with pending hub membership requests" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns one row per unapproved hub membership. A user may appear multiple times if they have pending requests across multiple hubs."

      response "200", "Users returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              id: {type: :integer},
              email: {type: :string},
              hub_name: {type: :string, nullable: true},
              hub_id: {type: :integer, nullable: true},
              created_at: {type: :string, format: "date-time"},
              requested_at: {type: :string, format: "date-time", nullable: true},
              last_login_at: {type: :string, format: "date-time", nullable: true},
              last_active_at: {type: :string, format: "date-time", nullable: true}
            },
            required: %w[id email hub_name hub_id created_at requested_at last_login_at last_active_at]
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/health" do
    get "Check system health status" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only endpoint to check system health including Sidekiq and Knowledge Service RQ metrics."

      response "200", "System is healthy" do
        schema type: :object,
          properties: {
            status: {type: :string, enum: ["ok", "warning"]},
            sidekiq: {
              type: :object,
              properties: {
                processed: {type: :integer},
                failed: {type: :integer},
                enqueued: {type: :integer},
                retry_size: {type: :integer},
                dead_size: {type: :integer},
                processes: {type: :integer},
                queues: {
                  type: :array,
                  items: {
                    type: :object,
                    properties: {
                      name: {type: :string},
                      size: {type: :integer},
                      latency: {type: :number}
                    }
                  }
                }
              }
            },
            knowledge_service_rq: {
              type: :object,
              properties: {
                status: {type: :string},
                enqueued_jobs: {type: :integer},
                failed_jobs: {type: :integer},
                active_workers: {type: :integer}
              }
            }
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end

        before do
          allow(Sidekiq::Stats).to receive(:new).and_return(
            double(processed: 1000, failed: 10, enqueued: 50)
          )
          allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
          allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
          allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 3))

          queue = double(name: "default", size: 50, latency: 100)
          allow(Sidekiq::Queue).to receive(:all).and_return([queue])

          allow(KnowledgeService).to receive(:health).and_return(
            {
              "status" => "ok",
              "enqueued_jobs" => 25,
              "failed_jobs" => 5,
              "active_workers" => 2
            }
          )
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(JSON.parse(response.body)["status"]).to eq("ok")
        end
      end

      response "503", "System is unhealthy" do
        schema type: :object,
          properties: {
            status: {type: :string, enum: ["ok", "warning"]},
            sidekiq: {type: :object},
            knowledge_service_rq: {type: :object}
          }

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end

        before do
          allow(Sidekiq::Stats).to receive(:new).and_return(
            double(processed: 1000, failed: 10, enqueued: 1500)
          )
          allow(Sidekiq::RetrySet).to receive(:new).and_return(double(size: 5))
          allow(Sidekiq::DeadSet).to receive(:new).and_return(double(size: 2))
          allow(Sidekiq::ProcessSet).to receive(:new).and_return(double(size: 0))

          queue = double(name: "default", size: 1500, latency: 100)
          allow(Sidekiq::Queue).to receive(:all).and_return([queue])

          allow(KnowledgeService).to receive(:health).and_return(
            {"status" => "ok", "enqueued_jobs" => 25, "failed_jobs" => 5, "active_workers" => 2}
          )
        end

        run_test! do |response|
          expect(response).to have_http_status(503)
          expect(JSON.parse(response.body)["status"]).to eq("warning")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/hubs/{id}" do
    patch "Update admin-only fields of a hub" do
      tags "Admin"
      consumes "application/json"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Updates sensitive hub fields: plan, trial dates, and custom limits. " \
                  "Trial dates must be in YYYY-MM-DD format. Custom limit values must be non-negative integers."
      parameter name: :id, in: :path, type: :integer, required: true, description: "Hub ID"
      parameter name: :hub, in: :body, schema: {
        type: :object,
        properties: {
          hub: {
            type: :object,
            properties: {
              plan: {type: :string, enum: Hub.plans.keys, example: "enterprise"},
              trial_started_at: {type: :string, format: :date, nullable: true, example: "2026-01-01"},
              trial_ends_at: {type: :string, format: :date, nullable: true, example: "2026-07-01"},
              custom_limits: {
                type: :object,
                nullable: true,
                properties: {
                  sources: {type: :integer, example: 20},
                  messages: {type: :integer, example: 5000},
                  documents: {type: :integer, example: 2000}
                }
              }
            }
          }
        },
        required: ["hub"]
      }

      response "200", "Hub updated successfully" do
        schema type: :object,
          properties: {
            id: {type: :integer},
            name: {type: :string},
            organization_name: {type: :string, nullable: true},
            plan: {type: :string},
            trial_active: {type: :boolean},
            trial_expired: {type: :boolean},
            trial_ends_at: {type: :string, nullable: true, format: "date-time"},
            invite_code: {type: :string, nullable: true},
            created_at: {type: :string, format: "date-time"},
            users_count: {type: :integer},
            active_external_users_count: {type: :integer},
            max_messages: {type: :integer, nullable: true},
            sources_count: {type: :integer},
            max_sources: {type: :integer, nullable: true},
            documents_count: {type: :integer},
            max_documents: {type: :integer, nullable: true},
            last_internal_conversation_at: {type: :string, nullable: true, format: "date-time"},
            last_external_conversation_at: {type: :string, nullable: true, format: "date-time"}
          },
          required: %w[id name plan trial_active trial_expired created_at users_count
            active_external_users_count sources_count documents_count
            last_internal_conversation_at last_external_conversation_at]

        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { create(:hub, plan: :enterprise).id }
        let(:hub) { {hub: {plan: "standard"}} }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json["plan"]).to eq("standard")
        end
      end

      response "422", "Validation error" do
        schema type: :object,
          properties: {
            errors: {type: :array, items: {type: :string}}
          },
          required: ["errors"]

        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { create(:hub, plan: :enterprise).id }
        let(:hub) { {hub: {plan: "invalid_plan"}} }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:hub).id }
        let(:hub) { {hub: {plan: "standard"}} }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { create(:hub).id }
        let(:hub) { {hub: {plan: "standard"}} }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Hub not found" do
        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { 999999 }
        let(:hub) { {hub: {plan: "enterprise"}} }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/admin/users/{id}" do
    delete "Delete an unconfirmed or hubless user" do
      tags "Admin"
      security [bearerAuth: []]
      description "Super admin only. Permanently deletes a user account, but only if the user has not yet confirmed their email address or is not a member of any hub."

      parameter name: :id, in: :path, type: :integer, required: true, description: "User ID"

      response "200", "User deleted successfully" do
        schema type: :object,
          properties: {
            message: {type: :string}
          },
          required: %w[message]

        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "422", "User has confirmed their account and is a member of a hub" do
        schema type: :object,
          properties: {
            error: {type: :string}
          },
          required: %w[error]

        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) do
          member = create(:user)
          create(:hub_membership, user: member, hub: create(:hub))
          member.id
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end

      response "404", "User not found" do
        let!(:super_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { 0 }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:user, confirmed_at: nil, confirmation_token: "token123", confirmation_sent_at: Time.current).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { 0 }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end

  describe "GET /api/admin/statistics" do
    let(:super_admin) { create(:user, email: "admin@meedan.com") }
    let(:regular_user) { create(:user, email: "user@example.com") }

    context "when user is a super admin" do
      it "returns the expected top-level keys" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to include("global_counts", "churned_hubs", "documents_by_sync_status", "messages_by_state", "questions_by_answered", "average_answer_times", "hubs_by_creation_date")
      end

      it "returns global_counts with the expected keys" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics", headers: headers

        json = JSON.parse(response.body)
        expect(json["global_counts"].keys).to match_array(
          %w[hubs sources conversations users external_users documents messages hubs_all_time hubs_churned]
        )
      end

      it "returns churned_hubs as an array of deleted-while-free hubs" do
        hub = create(:hub, plan: :free, name: "Doomed Hub")
        hard_delete_hub!(hub.id)
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics", headers: headers

        json = JSON.parse(response.body)
        expect(json["churned_hubs"]).to be_an(Array)
        expect(json["churned_hubs"].map { |row| row["hub_name"] }).to include("Doomed Hub")
      end

      it "returns documents_by_sync_status as an array of buckets" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics", headers: headers

        json = JSON.parse(response.body)
        expect(json["documents_by_sync_status"]).to be_an(Array)
        expect(json["documents_by_sync_status"].first).to include("date", "pending", "error", "complete")
      end

      it "accepts a group_by param" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics?group_by=month", headers: headers

        expect(response).to have_http_status(:ok)
      end

      it "returns hubs_by_creation_date as an array of buckets counting active and hard-deleted hubs" do
        ActiveRecord::Base.connection.execute("TRUNCATE audit.hubs_log")
        create(:hub, created_at: 1.week.ago)
        deleted = create(:hub, created_at: 1.week.ago)
        hard_delete_hub!(deleted.id)
        headers = auth_headers_for(super_admin)

        get "/api/admin/statistics", headers: headers

        json = JSON.parse(response.body)
        expect(json["hubs_by_creation_date"]).to be_an(Array)
        bucket = json["hubs_by_creation_date"].find { |b| b["date"] == 1.week.ago.beginning_of_week.to_date.iso8601 }
        expect(bucket).to include("active" => 1, "deleted" => 1)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        get "/api/admin/statistics", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        get "/api/admin/statistics"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end

  describe "GET /api/admin/hubs/:id/deleted" do
    let(:super_admin) { create(:user, email: "admin@meedan.com") }
    let(:regular_user) { create(:user, email: "user@example.com") }

    context "when user is a super admin" do
      it "returns the deleted hub's summary and activity" do
        hub = create(:hub, plan: :free, name: "Gone Hub")
        hard_delete_hub!(hub.id)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}/deleted", headers: headers

        expect(response).to have_http_status(:ok)
        json = JSON.parse(response.body)
        expect(json).to include("hub_id" => hub.id, "hub_name" => "Gone Hub")
        expect(json["activity"]).to be_an(Array)
      end

      it "returns 404 for a hub that is still live" do
        hub = create(:hub)
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/#{hub.id}/deleted", headers: headers

        expect(response).to have_http_status(:not_found)
      end

      it "returns 404 for an id that never existed" do
        headers = auth_headers_for(super_admin)

        get "/api/admin/hubs/999999/deleted", headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end

    context "when user is not a super admin" do
      it "returns forbidden" do
        hub = create(:hub, plan: :free)
        hard_delete_hub!(hub.id)

        get "/api/admin/hubs/#{hub.id}/deleted", headers: auth_headers_for(regular_user)

        expect(response).to have_http_status(:forbidden)
      end
    end

    context "when user is not authenticated" do
      it "returns unauthorized" do
        hub = create(:hub, plan: :free)
        hard_delete_hub!(hub.id)

        get "/api/admin/hubs/#{hub.id}/deleted"

        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end

# Tests for Swagger / OpenAPI documentation - statistics endpoint

describe "Admin API statistics" do
  path "/api/admin/statistics" do
    get "Get platform-wide analytics statistics" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns global counts (including all-time and churned hub counts, read from the audit log so a hard-deleted hub still counts), the churned-hubs list, documents by sync status, messages by state, bot replies by answered/unanswered, and average answer time."
      parameter name: :group_by, in: :query, type: :string, required: false, description: "Time bucket: day, week (default), or month"
      parameter name: :from, in: :query, type: :string, required: false, description: "Start of date range (ISO 8601)"
      parameter name: :to, in: :query, type: :string, required: false, description: "End of date range (ISO 8601)"

      response "200", "Statistics returned successfully" do
        schema type: :object,
          properties: {
            global_counts: {
              type: :object,
              properties: {
                hubs: {type: :integer, description: "Currently-active (live) hub count"},
                sources: {type: :integer},
                conversations: {type: :integer},
                users: {type: :integer},
                external_users: {type: :integer},
                documents: {type: :integer},
                messages: {type: :integer},
                hubs_all_time: {type: :integer, description: "Every hub ever created, including hard-deleted ones"},
                hubs_churned: {type: :integer, description: "Hubs hard-deleted while still on a free plan"}
              },
              required: %w[hubs sources conversations users external_users documents messages hubs_all_time hubs_churned]
            },
            churned_hubs: {
              type: :array,
              description: "Hubs hard-deleted while still on a free plan, most-recently-deleted first",
              items: {
                type: :object,
                properties: {
                  hub_id: {type: :integer},
                  hub_name: {type: :string},
                  organization_name: {type: :string, nullable: true},
                  plan_at_deletion: {type: :string},
                  created_at: {type: :string, format: "date-time"},
                  deleted_at: {type: :string, format: "date-time"}
                },
                required: %w[hub_id hub_name organization_name plan_at_deletion created_at deleted_at]
              }
            },
            documents_by_sync_status: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  date: {type: :string, format: "date"},
                  pending: {type: :integer},
                  error: {type: :integer},
                  complete: {type: :integer}
                },
                required: %w[date pending error complete]
              }
            },
            messages_by_state: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  date: {type: :string, format: "date"},
                  user_message: {type: :integer},
                  bot_message: {type: :integer}
                },
                required: %w[date]
              }
            },
            questions_by_answered: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  date: {type: :string, format: "date"},
                  answered: {type: :integer},
                  unanswered: {type: :integer}
                },
                required: %w[date answered unanswered]
              }
            },
            average_answer_times: {
              type: :object,
              properties: {
                all_time: {type: :number, nullable: true},
                last_week: {type: :number, nullable: true},
                last_month: {type: :number, nullable: true}
              }
            },
            hubs_by_creation_date: {
              type: :array,
              description: "Hubs created per bucket, split by whether they're still live or were since hard-deleted",
              items: {
                type: :object,
                properties: {
                  date: {type: :string, format: "date"},
                  active: {type: :integer},
                  deleted: {type: :integer}
                },
                required: %w[date active deleted]
              }
            }
          },
          required: %w[global_counts churned_hubs documents_by_sync_status messages_by_state questions_by_answered hubs_by_creation_date]

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        let(:group_by) { "week" }
        let(:from) { nil }
        let(:to) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to include("global_counts", "churned_hubs", "documents_by_sync_status", "messages_by_state", "questions_by_answered", "hubs_by_creation_date")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

describe "Admin API deleted hub detail" do
  path "/api/admin/hubs/{id}/deleted" do
    get "Get a deleted hub's summary and activity timeline" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Super admin only. Returns a hard-deleted hub's last known name, organization, plan at deletion, created/deleted dates, and its full activity timeline — all read from the audit log, since the hub no longer exists as a live row. 404s for a hub id that is still live or never existed."
      parameter name: :id, in: :path, type: :integer, required: true, description: "Hub ID"

      response "200", "Deleted hub summary returned successfully" do
        schema type: :object,
          properties: {
            hub_id: {type: :integer},
            hub_name: {type: :string},
            organization_name: {type: :string, nullable: true},
            plan_at_deletion: {type: :string},
            created_at: {type: :string, format: "date-time"},
            deleted_at: {type: :string, format: "date-time"},
            activity: {
              type: :array,
              items: {
                type: :object,
                properties: {
                  type: {type: :string},
                  at: {type: :string, format: "date-time"},
                  actor_email: {type: :string, nullable: true},
                  detail: {type: :string, nullable: true},
                  old_plan: {type: :string, nullable: true, description: "Only present on plan_changed events"},
                  new_plan: {type: :string, nullable: true, description: "Only present on plan_changed events"}
                },
                required: %w[type at actor_email detail]
              }
            }
          },
          required: %w[hub_id hub_name organization_name plan_at_deletion created_at deleted_at activity]

        let!(:super_admin) { create(:user, email: "admin@meedan.com") }
        let(:id) do
          hub = create(:hub, plan: :free)
          ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hub_memberships WHERE hub_id = ?", hub.id]))
          ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hubs WHERE id = ?", hub.id]))
          hub.id
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(super_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to include("hub_id", "hub_name", "activity")
        end
      end

      response "403", "Forbidden - Not a super admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:hub).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { create(:hub).id }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end
end

describe "Admin API platform admins" do
  path "/api/admin/users/super-admins" do
    get "List all platform admins" do
      tags "Admin"
      produces "application/json"
      security [bearerAuth: []]
      description "Write super admin only. Returns all confirmed Meedan email users (meedan.com or meedan.org), with their admin_write_access flag indicating whether they have write or read-only access."

      response "200", "Platform admins returned successfully" do
        schema type: :array,
          items: {
            type: :object,
            properties: {
              id: {type: :integer},
              email: {type: :string},
              admin_write_access: {type: :boolean},
              created_at: {type: :string, format: "date-time"}
            },
            required: %w[id email admin_write_access created_at]
          }

        let!(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(write_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Not a write platform admin" do
        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
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

  path "/api/admin/users/{id}/upgrade-to-write-admin" do
    patch "Upgrade a read-only platform admin to write platform admin" do
      tags "Admin"
      security [bearerAuth: []]
      description "Write super admin only. Grants write platform admin access to a confirmed Meedan email user who currently has read-only access."

      parameter name: :id, in: :path, type: :integer, required: true, description: "User ID of the platform admin to upgrade"

      response "200", "User upgraded successfully" do
        schema type: :object,
          properties: {
            message: {type: :string}
          },
          required: %w[message]

        let!(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { create(:user, email: "readonly@meedan.com", admin_write_access: false).id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(write_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "403", "Forbidden - Requester is not a write platform admin, or target user is not a platform admin" do
        schema type: :object,
          properties: {
            error: {type: :string}
          },
          required: %w[error]

        let!(:regular_user) { create(:user, email: "user@example.com") }
        let(:id) { create(:user, email: "target@meedan.com").id }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(regular_user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "404", "User not found" do
        schema type: :object,
          properties: {
            error: {type: :string}
          },
          required: %w[error]

        let!(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
        let(:id) { 0 }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(write_admin, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "401", "Unauthorized" do
        let(:id) { 0 }
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end
  path "/api/admin/users/{id}/move-to-hub" do
    patch "Move a stray signup into an existing hub" do
      tags "Admin"
      consumes "application/json"
      produces "application/json"
      security [bearerAuth: []]
      description "Write super admin only. Moves a user who is the sole member of a free trial hub into another hub as an editor. " \
                  "The new membership is pending approval by the target hub's admins unless approved is true. The original hub is left in place."

      parameter name: :id, in: :path, type: :integer, required: true, description: "User ID"
      parameter name: :move, in: :body, schema: {
        type: :object,
        properties: {
          hub_id: {type: :integer, description: "Target hub ID"},
          approved: {type: :boolean, description: "Approve the new membership right away instead of leaving it to the hub's admins"}
        },
        required: %w[hub_id]
      }

      let!(:write_admin) { create(:user, email: "admin@meedan.com", admin_write_access: true) }
      let(:target_hub) { create(:hub).tap { |hub| create(:hub_membership, hub: hub, role: :admin) } }
      let(:stray_user) { create(:hub_membership, hub: create(:hub, plan: :free), role: :admin).user }
      let(:id) { stray_user.id }
      let(:move) { {hub_id: target_hub.id} }
      let(:Authorization) do
        token, _ = Warden::JWTAuth::UserEncoder.new.call(write_admin, :user, nil)
        "Bearer #{token}"
      end

      response "200", "User moved successfully" do
        schema type: :object,
          properties: {
            message: {type: :string}
          },
          required: %w[message]

        run_test!
      end

      response "422", "User is not the sole member of a free trial hub, or the target hub has no approved admin or is scheduled for deletion" do
        schema type: :object,
          properties: {
            error: {type: :string}
          },
          required: %w[error]

        let(:id) { create(:hub_membership, hub: create(:hub)).user.id }
        run_test!
      end

      response "403", "Forbidden - Requester is not a write platform admin, or the user is a platform admin" do
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(create(:user, email: "readonly@meedan.com"), :user, nil)
          "Bearer #{token}"
        end
        run_test!
      end

      response "404", "User or hub not found" do
        let(:id) { 0 }
        run_test!
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        run_test!
      end
    end
  end
end
