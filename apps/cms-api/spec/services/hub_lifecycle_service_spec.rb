require "rails_helper"

RSpec.describe HubLifecycleService, type: :service do
  let(:service) { HubLifecycleService.new }

  # This service's population comes from audit.hubs_log directly, not from a query scoped to live
  # Hub ids. A couple of unrelated spec files clean up with DatabaseCleaner.clean_with(:truncation),
  # which does not fire the DELETE audit trigger — that leaves permanent, real rows behind in the
  # audit schema that a normal transactional-fixture rollback would never produce. Truncating here
  # (itself transactional, so it only clears the audit table for the duration of this example)
  # keeps this spec file's population isolated from that unrelated pre-existing debris.
  before do
    ActiveRecord::Base.connection.execute("TRUNCATE audit.hubs_log")
  end

  def hard_delete_hub!(hub_id)
    ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql(["DELETE FROM hub_memberships WHERE hub_id = ?", hub_id])
    )
    ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hubs WHERE id = ?", hub_id]))
  end

  describe "#total_hub_count" do
    it "counts a still-live hub" do
      create(:hub)
      expect(service.total_hub_count).to eq(1)
    end

    it "still counts a hub after it's been hard-deleted" do
      hub = create(:hub, plan: :free)
      hard_delete_hub!(hub.id)
      expect(service.total_hub_count).to eq(1)
    end

    it "does not double-count a hub that is both created and deleted within the audit log" do
      hub = create(:hub, plan: :free)
      hard_delete_hub!(hub.id)
      create(:hub)
      expect(service.total_hub_count).to eq(2)
    end
  end

  describe "#churned_hub_count and #churned_hubs" do
    it "counts a hub deleted while on a free plan" do
      hub = create(:hub, plan: :free)
      hard_delete_hub!(hub.id)
      expect(service.churned_hub_count).to eq(1)
      expect(service.churned_hubs.map { |row| row["hub_id"] }).to include(hub.id)
    end

    it "excludes a hub deleted while on a paid plan" do
      hub = create(:hub, plan: :standard)
      hard_delete_hub!(hub.id)
      expect(service.churned_hub_count).to eq(0)
      expect(service.churned_hubs).to be_empty
    end

    it "excludes a still-live free hub" do
      create(:hub, plan: :free)
      expect(service.churned_hub_count).to eq(0)
    end

    it "includes the hub's name, organization name, and plan at deletion" do
      org = create(:organization, name: "Acme Org")
      hub = create(:hub, plan: :free_unrestricted, name: "Doomed Hub", organization: org)
      hard_delete_hub!(hub.id)

      row = service.churned_hubs.find { |r| r["hub_id"] == hub.id }
      expect(row).to include(
        "hub_name" => "Doomed Hub",
        "organization_name" => "Acme Org",
        "plan_at_deletion" => "free_unrestricted"
      )
      expect(row["created_at"]).not_to be_nil
      expect(row["deleted_at"]).not_to be_nil
    end

    it "sorts churned hubs most-recently-deleted first" do
      older = create(:hub, plan: :free)
      hard_delete_hub!(older.id)
      newer = create(:hub, plan: :free)
      hard_delete_hub!(newer.id)

      expect(service.churned_hubs.first["hub_id"]).to eq(newer.id)
      expect(service.churned_hubs.last["hub_id"]).to eq(older.id)
    end
  end

  describe "#creation_dates" do
    it "lists a still-live hub's creation time under :active" do
      hub = create(:hub, created_at: 1.week.ago)
      result = service.creation_dates
      expect(result[:active].map(&:to_date)).to eq([hub.created_at.to_date])
      expect(result[:deleted]).to be_empty
    end

    it "lists a hard-deleted hub's creation time under :deleted, whatever its plan" do
      free = create(:hub, plan: :free, created_at: 3.weeks.ago)
      paid = create(:hub, plan: :standard, created_at: 2.weeks.ago)
      hard_delete_hub!(free.id)
      hard_delete_hub!(paid.id)

      result = service.creation_dates
      expect(result[:active]).to be_empty
      expect(result[:deleted].map(&:to_date)).to match_array([3.weeks.ago.to_date, 2.weeks.ago.to_date])
    end
  end

  describe "#deleted_hub_summary" do
    it "returns the summary for a deleted hub" do
      hub = create(:hub, plan: :free, name: "Gone Hub")
      hard_delete_hub!(hub.id)

      summary = service.deleted_hub_summary(hub.id)
      expect(summary["hub_name"]).to eq("Gone Hub")
    end

    it "returns nil for a hub that is still live" do
      hub = create(:hub)
      expect(service.deleted_hub_summary(hub.id)).to be_nil
    end

    it "returns nil for an id that never existed" do
      expect(service.deleted_hub_summary(999_999_999)).to be_nil
    end
  end
end
