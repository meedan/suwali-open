require "rails_helper"

RSpec.describe HubActivityService, type: :service do
  describe "#timeline" do
    it "includes a hub_created event" do
      hub = create(:hub)

      events = HubActivityService.new(hub.id).timeline

      expect(events.map { |e| e["type"] }).to include("hub_created")
    end

    it "includes a hub_deleted event, distinct from deletion_requested" do
      hub = create(:hub, plan: :free)
      hub_id = hub.id
      ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hub_memberships WHERE hub_id = ?", hub_id]))
      ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hubs WHERE id = ?", hub_id]))

      events = HubActivityService.new(hub_id).timeline

      expect(events.map { |e| e["type"] }).to include("hub_deleted")
      expect(events.map { |e| e["type"] }).not_to include("deletion_requested")
    end

    it "includes a plan_changed event describing the old and new plan" do
      hub = create(:hub, plan: :free)
      hub.update!(plan: :standard)

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "plan_changed" }

      expect(event["detail"]).to eq("free → standard")
      expect(event["old_plan"]).to eq("free")
      expect(event["new_plan"]).to eq("standard")
    end

    it "includes a deletion_requested event" do
      hub = create(:hub, plan: :free)
      hub.update!(deletion_requested_at: Time.current)

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "deletion_requested" }

      expect(event).not_to be_nil
    end

    it "includes membership_added and membership_removed events naming the member" do
      hub = create(:hub)
      member = create(:user, email: "member@example.com")
      membership = create(:hub_membership, hub: hub, user: member)
      membership.destroy!

      events = HubActivityService.new(hub.id).timeline

      expect(events.find { |e| e["type"] == "membership_added" }["detail"]).to eq("member@example.com")
      expect(events.find { |e| e["type"] == "membership_removed" }["detail"]).to eq("member@example.com")
    end

    it "includes source_added and source_removed events naming the source" do
      hub = create(:hub)
      # insert_all! bypasses Source's async_destroy_with worker and any Knowledge Service push, which
      # a plain create/destroy would otherwise trigger for no reason in this test.
      source_id = Source.insert_all!(
        [{hub_id: hub.id, name: "Docs", source_type: 5, config: {}, active: true, preloaded: false,
          documents_count: 0, created_at: Time.current, updated_at: Time.current}],
        returning: %w[id]
      ).pluck("id").first
      ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM sources WHERE id = ?", source_id]))

      events = HubActivityService.new(hub.id).timeline

      expect(events.find { |e| e["type"] == "source_added" }["detail"]).to include("Docs")
      expect(events.find { |e| e["type"] == "source_removed" }["detail"]).to include("Docs")
    end

    it "excludes preloaded sources" do
      hub = create(:hub)
      Source.insert_all!(
        [{hub_id: hub.id, name: "Preloaded", source_type: 5, config: {}, active: true, preloaded: true,
          documents_count: 0, created_at: Time.current, updated_at: Time.current}]
      )

      events = HubActivityService.new(hub.id).timeline

      expect(events.map { |e| e["type"] }).not_to include("source_added")
    end

    it "includes only one document_first_synced event, not one per document" do
      hub = create(:hub)
      source_id = Source.insert_all!(
        [{hub_id: hub.id, name: "Docs", source_type: 5, config: {}, active: true, preloaded: false,
          documents_count: 0, created_at: Time.current, updated_at: Time.current}],
        returning: %w[id]
      ).pluck("id").first
      Document.insert_all!(
        [
          {source_id: source_id, title: "one.txt", external_id: SecureRandom.hex(16), document_type: 4,
           content: "test", metadata: {}, active: true, sync_status: 2, priority_tier: 1, document_size: 1,
           created_at: 2.days.ago, updated_at: 2.days.ago},
          {source_id: source_id, title: "two.txt", external_id: SecureRandom.hex(16), document_type: 4,
           content: "test", metadata: {}, active: true, sync_status: 2, priority_tier: 1, document_size: 1,
           created_at: 1.day.ago, updated_at: 1.day.ago}
        ]
      )

      events = HubActivityService.new(hub.id).timeline

      expect(events.count { |e| e["type"] == "document_first_synced" }).to eq(1)
    end

    it "includes messaging_connected and messaging_disconnected events naming the platform" do
      hub = create(:hub)
      integration = create(:internal_messaging_integration, hub: hub)
      integration.destroy!

      events = HubActivityService.new(hub.id).timeline

      expect(events.find { |e| e["type"] == "messaging_connected" }["detail"]).to eq("InternalMessagingIntegration")
      expect(events.find { |e| e["type"] == "messaging_disconnected" }["detail"]).to eq("InternalMessagingIntegration")
    end

    it "attributes an event to the user who made the change" do
      actor = create(:user)
      hub = create(:hub, plan: :free)

      ActiveRecord::Base.transaction do
        ActiveRecord::Base.connection.execute(
          ActiveRecord::Base.sanitize_sql(["SET LOCAL audit.current_user_id = ?", actor.id.to_s])
        )
        hub.update!(plan: :standard)
      end

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "plan_changed" }
      expect(event["actor_email"]).to eq(actor.email)
    end

    it "leaves actor_email nil when no audit session user was set" do
      hub = create(:hub)

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "hub_created" }
      expect(event["actor_email"]).to be_nil
    end

    it "sorts events newest first" do
      hub = create(:hub, plan: :free)
      hub.update!(deletion_requested_at: Time.current)

      events = HubActivityService.new(hub.id).timeline

      expect(events.first["type"]).to eq("deletion_requested")
      expect(events.last["type"]).to eq("hub_created")
    end

    it "includes a trial_dates_changed event describing only the field that actually changed" do
      hub = create(:hub, plan: :free)
      hub.update!(trial_ends_at: hub.trial_ends_at + 7.days)

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "trial_dates_changed" }

      expect(event["detail"]).to start_with("End: ")
      expect(event["detail"]).not_to include("Start: ")
    end

    it "includes a custom_limits_changed event per changed key" do
      hub = create(:hub, plan: :enterprise, custom_limits: {"sources" => 50})
      hub.update!(custom_limits: {"sources" => 100, "sms" => true})

      events = HubActivityService.new(hub.id).timeline.select { |e| e["type"] == "custom_limits_changed" }

      expect(events.map { |e| e["detail"] }).to include("sources: 50 → 100", "sms: nil → true")
    end

    # custom_limits starts out NULL on every hub, which the audit log records as JSON null
    it "includes a custom_limits_changed event when the hub had no custom limits at all" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.reload.custom_limits).to be_nil
      hub.update!(custom_limits: {"sources" => 10})

      events = HubActivityService.new(hub.id).timeline.select { |e| e["type"] == "custom_limits_changed" }

      expect(events.map { |e| e["detail"] }).to eq(["sources: nil → 10"])
    end

    it "includes a feature_flag_changed event per changed flag" do
      hub = create(:hub, allowed_features: {"MY_FEATURE" => false})
      hub.update!(allowed_features: {"MY_FEATURE" => true})

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "feature_flag_changed" }

      expect(event["detail"]).to eq("MY_FEATURE: false → true")
    end

    it "includes a trial_emails_toggled event describing the new state" do
      hub = create(:hub, plan: :free) # trial_emails_enabled defaults to true
      hub.update!(trial_emails_enabled: false)

      event = HubActivityService.new(hub.id).timeline.find { |e| e["type"] == "trial_emails_toggled" }

      expect(event["detail"]).to eq("Disabled")
    end
  end
end
