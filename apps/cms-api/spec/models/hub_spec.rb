require "rails_helper"

RSpec.describe Hub, type: :model do
  it "is valid with valid attributes" do
    hub = build(:hub)
    expect(hub).to be_valid
  end

  it "is invalid without a name" do
    hub = build(:hub, name: nil)
    expect(hub).not_to be_valid
  end

  it "should have an invite code" do
    hub = create(:hub)
    expect(hub.invite_code).not_to be_nil
  end

  it "should generate invite code" do
    hub = create(:hub, invite_code: nil)
    expect(hub.invite_code).not_to be_nil
  end

  it "has users" do
    hub = create(:hub)
    user = create(:user)
    expect {
      hub.users << user
    }.to change { HubMembership.count }.by(1)
    expect(hub.users).to eq([user])
  end

  it "should generate contribution code" do
    hub = create(:hub)
    expect(hub.contribution_code).not_to be_nil
  end

  describe "contribution audience" do
    it "defaults to trusted end-users" do
      expect(create(:hub).contribution_audience).to eq("trusted_end_users")
    end

    it "is invalid with an unknown value" do
      hub = build(:hub, contribution_audience: "anyone")
      expect(hub).not_to be_valid
    end
  end

  describe "contribution code" do
    let(:hub) { create(:hub) }

    it "normalizes the code to a single leading hashtag" do
      hub.update!(contribution_code: "  MyHub2026 ")
      expect(hub.reload.contribution_code).to eq("#MyHub2026")
      hub.update!(contribution_code: "##MyHub2026")
      expect(hub.reload.contribution_code).to eq("#MyHub2026")
    end

    it "is invalid when blank" do
      hub.contribution_code = " # "
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_contribution_code_blank))
    end

    it "is invalid when too short, too long or not alphanumeric" do
      ["short", "a" * 37, "my hub", "my-hub", "my_hub!"].each do |code|
        hub.contribution_code = code
        expect(hub).not_to be_valid, "expected #{code.inspect} to be rejected"
        expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_contribution_code))
      end
    end

    it "allows two hubs to share the same code" do
      hub.update!(contribution_code: "#sharedcode")
      other = create(:hub)
      expect(other.update(contribution_code: "#sharedcode")).to be true
    end
  end

  it "returns its topic names sorted alphabetically" do
    hub = create(:hub)
    hub.topics.create!(name: "Elections")
    hub.topics.create!(name: "Climate")
    expect(hub.topic_names).to eq(["Climate", "Elections"])
  end

  describe ".create_with_organization!" do
    it "creates the hub with an organization of the same name" do
      hub = Hub.create_with_organization!(name: "Acme", plan: :enterprise, skip_data_preload: true)

      expect(hub).to be_persisted
      expect(hub.organization.name).to eq("Acme")
      expect(hub).to be_enterprise
    end

    it "does not leave an organization behind when the hub is invalid" do
      expect {
        expect { Hub.create_with_organization!(name: "a" * 101, plan: :enterprise) }.to raise_error(ActiveRecord::RecordInvalid)
      }.not_to change(Organization, :count)
    end
  end

  describe "invite code generation" do
    it "generates 6-character Base-36 invite code" do
      code = Hub.generate_invite_code
      expect(code).to match(/\A[A-Z0-9]{6}\z/)
      expect(code.length).to eq(6)
    end

    it "generates uppercase invite codes" do
      code = Hub.generate_invite_code
      expect(code).to eq(code.upcase)
    end

    it "reserves invite codes to prevent reuse" do
      code = Hub.generate_invite_code
      expect(HubReservedInviteCode.exists?(code: code)).to be true
    end

    it "does not reuse existing invite codes" do
      hub1 = create(:hub)
      code1 = hub1.invite_code

      # Reserve the code1 to ensure it's in the reserved codes table
      expect(HubReservedInviteCode.exists?(code: code1)).to be true

      # Force generate_invite_code to try the same code first, then a different one
      allow(SecureRandom).to receive(:random_number).and_return(code1.to_i(36), 999999)

      code2 = Hub.generate_invite_code
      expect(code2).not_to eq(code1)
    end

    it "handles concurrent collisions with retry" do
      # Create a reserved code first
      reserved_code = 123456
      HubReservedInviteCode.create!(code: reserved_code.to_s(36).upcase.rjust(6, "0"))

      # Simulate collision by stubbing to return reserved code first, then different value
      allow(SecureRandom).to receive(:random_number).and_return(reserved_code, 789012)

      code = Hub.generate_invite_code

      expect(code).not_to eq(reserved_code.to_s(36).upcase.rjust(6, "0"))
      expect(HubReservedInviteCode.count).to eq(2)
    end

    it "raises error after max retries" do
      # Create a reserved code
      reserved_code = 123456
      HubReservedInviteCode.create!(code: reserved_code.to_s(36).upcase.rjust(6, "0"))

      # Simulate persistent collision (always return the same reserved code)
      allow(SecureRandom).to receive(:random_number).and_return(reserved_code)

      # Should fail after retries
      expect {
        Hub.generate_invite_code
      }.to raise_error(/Failed to generate unique invite code/)
    end
  end

  describe "plan and trial" do
    it "defaults to free plan" do
      hub = Hub.create! name: Faker::Name.name, organization: create(:organization)
      expect(hub.plan).to eq("free")
      expect(hub.free?).to be true
    end

    it "sets trial dates automatically for free plan" do
      hub = create(:hub, plan: :free)
      expect(hub.trial_started_at).not_to be_nil
      expect(hub.trial_ends_at).not_to be_nil
      expect(hub.trial_ends_at).to be > hub.trial_started_at
    end

    it "does not set trial dates for premium plan" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.trial_started_at).to be_nil
      expect(hub.trial_ends_at).to be_nil
    end

    it "does not set trial dates for standard plan" do
      hub = create(:hub, plan: :standard)
      expect(hub.trial_started_at).to be_nil
      expect(hub.trial_ends_at).to be_nil
    end

    it "does not set trial dates for pro plan" do
      hub = create(:hub, plan: :pro)
      expect(hub.trial_started_at).to be_nil
      expect(hub.trial_ends_at).to be_nil
    end

    it "calculates trial end date based on trial length" do
      hub = create(:hub, plan: :free)
      expected_end = hub.trial_started_at + Hub.trial_length
      expect(hub.trial_ends_at).to be_within(1.second).of(expected_end)
    end

    it "preserves explicitly set trial dates" do
      custom_start = 1.week.ago
      custom_end = 1.week.from_now
      hub = create(:hub, plan: :free, trial_started_at: custom_start, trial_ends_at: custom_end)
      expect(hub.trial_started_at).to be_within(1.second).of(custom_start)
      expect(hub.trial_ends_at).to be_within(1.second).of(custom_end)
    end
  end

  describe "plan and trial - free_unrestricted" do
    it "sets trial dates automatically for free_unrestricted plan" do
      hub = create(:hub, plan: :free_unrestricted)
      expect(hub.trial_started_at).not_to be_nil
      expect(hub.trial_ends_at).not_to be_nil
      expect(hub.trial_ends_at).to be > hub.trial_started_at
    end

    it "preserves existing trial dates when converting from free to free_unrestricted" do
      hub = create(:hub, plan: :free)
      original_start = hub.trial_started_at
      original_end = hub.trial_ends_at

      hub.update!(plan: :free_unrestricted)

      expect(hub.trial_started_at).to eq(original_start)
      expect(hub.trial_ends_at).to eq(original_end)
    end

    it "can convert from free_unrestricted to free while preserving trial dates" do
      hub = create(:hub, plan: :free_unrestricted)
      original_start = hub.trial_started_at
      original_end = hub.trial_ends_at

      hub.update!(plan: :free)

      expect(hub.trial_started_at).to eq(original_start)
      expect(hub.trial_ends_at).to eq(original_end)
    end
  end

  describe "trial state helpers" do
    it "trial_active? returns true for active free plan trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      expect(hub.trial_active?).to be true
    end

    it "trial_active? returns false for expired free plan trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      expect(hub.trial_active?).to be false
    end

    it "trial_active? returns false for premium plan" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.trial_active?).to be false
    end

    it "trial_expired? returns true for expired free plan trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      expect(hub.trial_expired?).to be true
    end

    it "trial_expired? returns false for active free plan trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      expect(hub.trial_expired?).to be false
    end

    it "trial_expired? returns false for premium plan" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.trial_expired?).to be false
    end
  end

  describe "trial state helpers - free_unrestricted" do
    it "trial_active? returns true for active free_unrestricted plan trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      expect(hub.trial_active?).to be true
    end

    it "trial_active? returns false for expired free_unrestricted plan trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      expect(hub.trial_active?).to be false
    end

    it "trial_expired? returns true for expired free_unrestricted plan trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      expect(hub.trial_expired?).to be true
    end

    it "trial_expired? returns false for active free_unrestricted plan trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      expect(hub.trial_expired?).to be false
    end
  end

  describe "trial validations" do
    it "rejects premium plans with trial dates" do
      hub = build(:hub, plan: :enterprise, trial_started_at: Time.current, trial_ends_at: 1.week.from_now)
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_premium_plans_no_trial))
    end

    it "rejects standard plans with trial dates" do
      hub = build(:hub, plan: :standard, trial_started_at: Time.current, trial_ends_at: 1.week.from_now)
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_premium_plans_no_trial))
    end

    it "rejects pro plans with trial dates" do
      hub = build(:hub, plan: :pro, trial_started_at: Time.current, trial_ends_at: 1.week.from_now)
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_premium_plans_no_trial))
    end

    it "rejects trial_ends_at before trial_started_at" do
      hub = build(:hub, plan: :free, trial_started_at: Time.current, trial_ends_at: 1.day.ago)
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_trial_ends_at_before_start))
    end

    it "rejects partial trial dates (only start)" do
      hub = create(:hub, plan: :free)
      hub.trial_ends_at = nil
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_trial_ends_at_missing))
    end

    it "rejects partial trial dates (only end)" do
      hub = create(:hub, plan: :free)
      hub.trial_started_at = nil
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_trial_started_at_missing))
    end
  end

  describe "trial validations - free_unrestricted" do
    it "requires trial dates for free_unrestricted plans" do
      hub = create(:hub, plan: :free_unrestricted)
      hub.trial_started_at = nil
      hub.trial_ends_at = nil
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_free_plans_require_trial))
    end

    it "rejects partial trial dates for free_unrestricted (only start)" do
      hub = create(:hub, plan: :free_unrestricted)
      hub.trial_ends_at = nil
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_trial_ends_at_missing))
    end

    it "rejects partial trial dates for free_unrestricted (only end)" do
      hub = create(:hub, plan: :free_unrestricted)
      hub.trial_started_at = nil
      expect(hub).not_to be_valid
      expect(hub.errors[:base]).to include(I18n.t(:error_hub_trial_started_at_missing))
    end
  end

  describe "adjust_trial_dates_on_plan_change" do
    it "clears trial dates when upgrading from free to premium" do
      hub = create(:hub, plan: :free)
      expect(hub.trial_started_at).to be_present
      expect(hub.trial_ends_at).to be_present

      hub.update!(plan: :standard)
      expect(hub.trial_started_at).to be_nil
      expect(hub.trial_ends_at).to be_nil
    end

    it "sets fresh trial dates when downgrading from premium to free" do
      hub = create(:hub, plan: :free)
      hub.update!(plan: :pro)
      expect(hub.trial_started_at).to be_nil

      hub.update!(plan: :free)
      expect(hub.trial_started_at).to be_present
      expect(hub.trial_ends_at).to be_present
      expect(hub.trial_ends_at).to be > Time.current
    end

    it "sets fresh trial dates when downgrading from premium to free_unrestricted" do
      hub = create(:hub, plan: :free)
      hub.update!(plan: :enterprise)

      hub.update!(plan: :free_unrestricted)
      expect(hub.trial_started_at).to be_present
      expect(hub.trial_ends_at).to be_present
    end

    it "does not change trial dates when plan stays the same" do
      hub = create(:hub, plan: :free)
      original_start = hub.trial_started_at
      original_end = hub.trial_ends_at

      hub.update!(name: "New Name")
      expect(hub.trial_started_at).to eq(original_start)
      expect(hub.trial_ends_at).to eq(original_end)
    end
  end

  describe "as_json - free_unrestricted" do
    it "includes trial dates in response for free_unrestricted hubs" do
      hub = create(:hub, plan: :free_unrestricted)
      json = hub.as_json

      expect(json[:plan]).to eq("free_unrestricted")
      expect(json[:trial_started_at]).to be_present
      expect(json[:trial_ends_at]).to be_present
      expect(json[:trial_active]).to be_in([true, false])
      expect(json[:trial_expired]).to be_in([true, false])
    end
  end

  describe ".eligible_for_deletion" do
    let(:grace_period) { Hub.trial_deletion_grace_period }

    it "does not include hubs with active trials" do
      hub = create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "does not include hubs with expired trial but within grace period" do
      trial_end = 15.days.ago
      hub = create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "includes free hubs with trial expired past grace period" do
      trial_end = Time.current - grace_period - 1.day
      hub = create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      expect(Hub.eligible_for_deletion).to include(hub)
    end

    it "includes free_unrestricted hubs with trial expired past grace period" do
      trial_end = Time.current - grace_period - 1.day
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      expect(Hub.eligible_for_deletion).to include(hub)
    end

    it "does not include premium hubs regardless of trial dates" do
      hub = create(:hub, plan: :enterprise)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "does not include standard hubs" do
      hub = create(:hub, plan: :standard)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "does not include pro hubs" do
      hub = create(:hub, plan: :pro)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "does not include hubs without trial_ends_at" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.trial_ends_at).to be_nil
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "includes free hubs flagged for deletion even with an active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now, deletion_requested_at: Time.current)
      expect(Hub.eligible_for_deletion).to include(hub)
    end

    it "does not include premium hubs flagged for deletion" do
      hub = create(:hub, plan: :enterprise, deletion_requested_at: Time.current)
      expect(Hub.eligible_for_deletion).not_to include(hub)
    end

    it "returns multiple eligible hubs" do
      trial_end = Time.current - grace_period - 1.day
      hub1 = create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      hub2 = create(:hub, plan: :free_unrestricted, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      hub3 = create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now)

      eligible = Hub.eligible_for_deletion
      expect(eligible).to include(hub1, hub2)
      expect(eligible).not_to include(hub3)
    end
  end

  describe ".with_deletion_lock" do
    let(:hub) { create(:hub, plan: :free) }

    it "allows entering block when lock is available" do
      result = nil
      status = Hub.with_deletion_lock(hub.id) do |locked_hub|
        result = locked_hub
      end

      expect(status).to eq(:success)
      expect(result).to eq(hub)
    end

    it "sets deletion_in_progress and deletion_started_at when acquiring lock" do
      Hub.with_deletion_lock(hub.id) do |locked_hub|
        locked_hub.reload
        expect(locked_hub.deletion_in_progress?).to be true
        expect(locked_hub.deletion_started_at).to be_within(1.second).of(Time.current)
      end
    end

    it "releases lock after block execution" do
      Hub.with_deletion_lock(hub.id) { |_h| }

      hub.reload
      expect(hub.deletion_in_progress?).to be false
      expect(hub.deletion_started_at).to be_nil
    end

    it "releases lock even if block raises an error" do
      expect {
        Hub.with_deletion_lock(hub.id) do |_h|
          raise "Test error"
        end
      }.to raise_error("Test error")

      hub.reload
      expect(hub.deletion_in_progress?).to be false
      expect(hub.deletion_started_at).to be_nil
    end

    it "returns :locked when lock is already held" do
      hub.update!(deletion_in_progress: true, deletion_started_at: Time.current)

      status = Hub.with_deletion_lock(hub.id) do |_h|
        # This block should not be executed
        raise "Should not be reached"
      end

      expect(status).to eq(:locked)
    end

    it "returns :not_found when hub does not exist" do
      status = Hub.with_deletion_lock(999999) do |_h|
        raise "Should not be reached"
      end

      expect(status).to eq(:not_found)
    end

    it "properly handles hub deletion within the block" do
      hub_id = hub.id

      status = Hub.with_deletion_lock(hub_id) do |locked_hub|
        locked_hub.destroy!
      end

      expect(status).to eq(:success)
      expect(Hub.find_by(id: hub_id)).to be_nil
    end
  end

  describe "#send_trial_emails" do
    let(:hub) { create(:hub, plan: :free) }
    let!(:admin_membership) { create(:hub_membership, hub: hub, role: :admin) }
    let(:admin) { admin_membership.user }
    let(:mailer) { double(deliver_later: nil) }

    it "sends the email to hub admins and tracks it" do
      expect(HubMailer).to receive(:trial_welcome).with(admin).and_return(mailer)

      hub.send_trial_emails(:trial_welcome)

      expect(hub.reload.trial_emails_sent).to include("trial_welcome")
    end

    it "sends to multiple admins" do
      second_admin = create(:hub_membership, hub: hub, role: :admin).user
      expect(HubMailer).to receive(:trial_halfway).with(admin).and_return(mailer)
      expect(HubMailer).to receive(:trial_halfway).with(second_admin).and_return(mailer)

      hub.send_trial_emails(:trial_halfway)

      expect(hub.reload.trial_emails_sent).to include("trial_halfway")
    end

    it "does nothing when trial_emails_enabled is false" do
      hub.update_columns(trial_emails_enabled: false, trial_emails_sent: [])
      expect(HubMailer).not_to receive(:trial_welcome)

      hub.send_trial_emails(:trial_welcome)

      expect(hub.reload.trial_emails_sent).to be_empty
    end

    it "does nothing for premium hubs" do
      premium_hub = create(:hub, plan: :enterprise)
      create(:hub_membership, hub: premium_hub, role: :admin)
      expect(HubMailer).not_to receive(:trial_welcome)

      premium_hub.send_trial_emails(:trial_welcome)
    end

    it "works for free_unrestricted hubs" do
      unrestricted_hub = create(:hub, plan: :free_unrestricted)
      unrestricted_admin = create(:hub_membership, hub: unrestricted_hub, role: :admin).user
      expect(HubMailer).to receive(:trial_welcome).with(unrestricted_admin).and_return(mailer)

      unrestricted_hub.send_trial_emails(:trial_welcome)

      expect(unrestricted_hub.reload.trial_emails_sent).to include("trial_welcome")
    end
  end

  describe "disable_trial_emails_on_date_change" do
    let!(:hub) { create(:hub, plan: :free) }

    it "disables trial emails when trial_started_at is changed" do
      expect(hub.trial_emails_enabled).to be true

      hub.update!(trial_started_at: 1.day.ago, trial_ends_at: 29.days.from_now)

      expect(hub.reload.trial_emails_enabled).to be false
    end

    it "disables trial emails when trial_ends_at is changed" do
      expect(hub.trial_emails_enabled).to be true

      hub.update!(trial_ends_at: 60.days.from_now)

      expect(hub.reload.trial_emails_enabled).to be false
    end

    it "does not disable trial emails when other attributes change" do
      expect(hub.trial_emails_enabled).to be true

      hub.update!(name: "New Name")

      expect(hub.reload.trial_emails_enabled).to be true
    end
  end

  describe "custom limits for enterprise plans" do
    it "uses custom_limits for enterprise hub when set" do
      hub = create(:hub, plan: :enterprise, custom_limits: {sources: 5, documents: 2000, messages: 50000})
      expect(hub.max_sources_for_plan).to eq(5)
      expect(hub.max_documents_for_plan).to eq(2000)
      expect(hub.max_messages_for_plan).to eq(50000)
    end

    it "returns nil (unlimited) for enterprise hub when custom_limits not set" do
      hub = create(:hub, plan: :enterprise)
      expect(hub.max_sources_for_plan).to be_nil
      expect(hub.max_documents_for_plan).to be_nil
      expect(hub.max_messages_for_plan).to be_nil
    end

    it "returns nil (unlimited) for enterprise hub when custom_limits is empty" do
      hub = create(:hub, plan: :enterprise, custom_limits: {})
      expect(hub.max_sources_for_plan).to be_nil
      expect(hub.max_documents_for_plan).to be_nil
      expect(hub.max_messages_for_plan).to be_nil
    end

    it "ignores custom_limits for non-enterprise plans" do
      hub = create(:hub, plan: :standard, custom_limits: {sources: 999, documents: 9999, messages: 99999})
      expect(hub.max_sources_for_plan).to eq(5)
      expect(hub.max_documents_for_plan).to eq(500)
      expect(hub.max_messages_for_plan).to eq(2000)
    end

    it "uses partial custom_limits for enterprise hub" do
      hub = create(:hub, plan: :enterprise, custom_limits: {sources: 10})
      expect(hub.max_sources_for_plan).to eq(10)
      expect(hub.max_documents_for_plan).to be_nil
      expect(hub.max_messages_for_plan).to be_nil
    end
  end

  describe "subsidized plan" do
    it "is a premium plan with its own limits" do
      hub = create(:hub, plan: :subsidized)

      expect(hub.premium?).to be true
      expect(hub.free?).to be false
      expect(hub.trial_started_at).to be_nil
      expect(hub.max_sources_for_plan).to eq(5)
      expect(hub.max_documents_for_plan).to eq(500)
      expect(hub.max_messages_for_plan).to eq(1000)
    end
  end

  describe "#monthly_messages_count" do
    it "counts only outgoing messages of the current month sent to end-users" do
      hub = create(:hub, plan: :standard)
      external_conversation = create(:conversation, :external, hub: hub)
      internal_conversation = create(:conversation, hub: hub)

      create(:message, :outgoing, conversation: external_conversation)
      create(:message, :outgoing, conversation: internal_conversation)
      create(:message, :outgoing, conversation: external_conversation, created_at: 1.month.ago.beginning_of_month)
      create(:message, :outgoing_to_external_enduser)

      expect(hub.monthly_messages_count).to eq(1)
      expect(hub.as_json(include_monthly_messages_count: true)[:monthly_messages_count]).to eq(1)
      expect(hub.as_json[:max_messages_for_plan]).to eq(2000)
    end

    it "is served only when asked for, so serializing a list of hubs does not count messages per hub" do
      hub = create(:hub, plan: :standard)

      expect(hub.as_json).not_to have_key(:monthly_messages_count)
    end
  end

  describe "plan validation" do
    it "is invalid with an unrecognised plan value" do
      hub = build(:hub, plan: :enterprise)
      hub.plan = "galaxy_brain"
      expect(hub).not_to be_valid
      expect(hub.errors[:plan]).not_to be_empty
    end

    it "is valid with every recognised plan value" do
      Hub.plans.each_key do |plan|
        hub = Hub.new(name: "Test", plan: plan, organization: build(:organization))
        hub.valid?
        expect(hub.errors[:plan]).to be_empty, "expected plan '#{plan}' to be valid but got: #{hub.errors[:plan]}"
      end
    end
  end

  describe "custom_limits schema validation" do
    it "is valid when custom_limits is nil" do
      hub = create(:hub, plan: :enterprise, custom_limits: nil)
      expect(hub).to be_valid
    end

    it "is valid when custom_limits is an empty hash" do
      hub = create(:hub, plan: :enterprise, custom_limits: {})
      expect(hub).to be_valid
    end

    it "is valid when all custom_limits values are non-negative integers" do
      hub = create(:hub, plan: :enterprise, custom_limits: {sources: 10, documents: 500, messages: 0})
      expect(hub).to be_valid
    end

    it "is invalid when a custom_limits value is a string" do
      hub = build(:hub, plan: :enterprise, custom_limits: {"sources" => "many"})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "sources"))
    end

    it "is invalid when a custom_limits value is negative" do
      hub = build(:hub, plan: :enterprise, custom_limits: {"documents" => -1})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "documents"))
    end

    it "is invalid when a custom_limits value is a float" do
      hub = build(:hub, plan: :enterprise, custom_limits: {"messages" => 1.5})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "messages"))
    end

    it "is invalid when custom_limits contains an unknown key" do
      hub = build(:hub, plan: :enterprise, custom_limits: {"sources" => 10, "max_queries" => 500})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_unknown_custom_limit_key, key: "max_queries"))
    end

    it "reports both unknown key and invalid value errors together" do
      hub = build(:hub, plan: :enterprise, custom_limits: {"sources" => -1, "unknown" => 5})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "sources"))
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_unknown_custom_limit_key, key: "unknown"))
    end

    it "is valid when the sms boolean toggle is true or false" do
      expect(build(:hub, custom_limits: {"sms" => true})).to be_valid
      expect(build(:hub, custom_limits: {"sms" => false})).to be_valid
    end

    it "is invalid when the sms toggle is not a boolean" do
      hub = build(:hub, custom_limits: {"sms" => 1})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "sms"))
    end
  end

  describe "bot languages validation" do
    it "is valid with no languages, a default only, or a default among the supported languages" do
      expect(build(:hub, bot_attributes: {})).to be_valid
      expect(build(:hub, bot_attributes: {"default_language" => "pt"})).to be_valid
      expect(build(:hub, bot_attributes: {"default_language" => "pt", "supported_languages" => ["en", "pt"]})).to be_valid
    end

    it "is invalid when a language is not supported" do
      hub = build(:hub, bot_attributes: {"default_language" => "xx", "supported_languages" => ["xx", "yy"]})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_unsupported_language, language: "xx"), I18n.t(:error_hub_unsupported_language, language: "yy"))
    end

    it "is invalid when the default language is not among the supported languages" do
      hub = build(:hub, bot_attributes: {"default_language" => "pt", "supported_languages" => ["en", "es"]})
      expect(hub).not_to be_valid
      expect(hub.errors.full_messages).to include(I18n.t(:error_hub_default_language_not_in_supported_languages))
    end
  end

  describe "#location_gate_enabled?" do
    it "is true only when the LOCATION_GATE feature is on" do
      expect(create(:hub, allowed_features: {"LOCATION_GATE" => true}).location_gate_enabled?).to be(true)
      expect(create(:hub, allowed_features: {"LOCATION_GATE" => false}).location_gate_enabled?).to be(false)
      expect(create(:hub, allowed_features: {}).location_gate_enabled?).to be(false)
    end
  end

  describe "#can_use_sms?" do
    it "is true only when custom_limits enables sms" do
      expect(create(:hub, plan: :standard, custom_limits: {"sms" => true}).can_use_sms?).to be(true)
      expect(create(:hub, plan: :enterprise, custom_limits: {"sms" => false}).can_use_sms?).to be(false)
      expect(create(:hub, plan: :enterprise, custom_limits: {}).can_use_sms?).to be(false)
      expect(create(:hub, plan: :enterprise, custom_limits: nil).can_use_sms?).to be(false)
    end

    it "is false on plans that do not include sms, even when custom_limits enables it" do
      [:free, :free_unrestricted, :subsidized].each do |plan|
        hub = create(:hub, plan: plan, custom_limits: {"sms" => true})

        expect(hub.can_use_sms?).to be(false)
        expect(build(:sms_messaging_integration, hub: hub)).not_to be_valid
      end
    end
  end

  describe "preloaded data" do
    before { allow(HubPreloadWorker).to receive(:url).and_return("https://example.com/faq.pdf") }

    it "creates the source in the foreground and leaves the document to the worker" do
      hub = nil
      expect { hub = create(:hub, skip_data_preload: false) }.to change { HubPreloadWorker.jobs.size }.by(1)

      source = hub.sources.last
      expect(source.preloaded).to be true
      expect(source.documents).to be_empty
    end

    it "names the source in the locale of the request" do
      allow(I18n).to receive(:t).and_call_original
      allow(I18n).to receive(:t).with(:preloaded_source_title) { I18n.locale.to_s }

      hub = I18n.with_locale(:pt) { create(:hub, skip_data_preload: false) }

      expect(hub.sources.last.name).to eq("pt")
    end

    it "does nothing for a hub that opts out" do
      hub = nil
      expect { hub = create(:hub, skip_data_preload: true) }.not_to change { HubPreloadWorker.jobs.size }
      expect(hub.sources).to be_empty
    end

    it "does nothing when no URL is configured" do
      allow(HubPreloadWorker).to receive(:url).and_return("")

      hub = nil
      expect { hub = create(:hub, skip_data_preload: false) }.not_to change { HubPreloadWorker.jobs.size }
      expect(hub.sources).to be_empty
    end
  end

  describe "onboarding_tasks" do
    let(:hub) { create(:hub) }

    it "returns false for all tasks when nothing has been created" do
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be false
      expect(tasks[:messaging_platform_connected]).to be false
      expect(tasks[:document_synced]).to be false
      expect(tasks[:internal_conversation_message_received]).to be false
    end

    it "returns true for source_created when a source exists" do
      create(:source, hub: hub)
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be true
      expect(tasks[:messaging_platform_connected]).to be false
    end

    it "returns true for source_created even after source is deleted" do
      source = create(:source, hub: hub)
      source.destroy!
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be true
      expect(tasks[:messaging_platform_connected]).to be false
    end

    it "returns true for source_created but false for own_source_created when only a preloaded source exists" do
      create(:source, hub: hub, preloaded: true)
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be true
      expect(tasks[:own_source_created]).to be false
    end

    it "returns true for own_source_created when the hub has a source of its own" do
      create(:source, hub: hub, preloaded: true)
      create(:source, hub: hub)
      expect(hub.onboarding_tasks[:own_source_created]).to be true
    end

    it "returns true for own_source_created even after the hub's own source is deleted" do
      source = create(:source, hub: hub)
      source.destroy!
      expect(hub.onboarding_tasks[:own_source_created]).to be true
    end

    it "returns true for document_synced but false for own_document_synced when only a preloaded document is synced" do
      source = create(:source, hub: hub, preloaded: true)
      document = create(:document, source: source)
      document.update_column(:sync_status, Document.sync_statuses[:complete])
      tasks = hub.onboarding_tasks
      expect(tasks[:document_synced]).to be true
      expect(tasks[:own_document_synced]).to be false
    end

    it "returns true for own_document_synced when a document of the hub's own source is synced" do
      document = create(:document, source: create(:source, hub: hub))
      document.update_column(:sync_status, Document.sync_statuses[:complete])
      expect(hub.onboarding_tasks[:own_document_synced]).to be true
    end

    it "returns true for own_document_synced even after the synced document is deleted" do
      document = create(:document, source: create(:source, hub: hub))
      document.update_column(:sync_status, Document.sync_statuses[:complete])
      document.destroy!
      expect(hub.onboarding_tasks[:own_document_synced]).to be true
    end

    it "returns true for messaging_platform_connected when a messaging integration exists" do
      create(:whatsapp_messaging_integration, hub: hub)
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be false
      expect(tasks[:messaging_platform_connected]).to be true
    end

    it "returns true for messaging_platform_connected even after messaging integration is deleted" do
      integration = create(:whatsapp_messaging_integration, hub: hub)
      integration.destroy!
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be false
      expect(tasks[:messaging_platform_connected]).to be true
    end

    it "returns true for document_synced when a synced document exists" do
      source = create(:source, hub: hub)
      document = create(:document, source: source)
      document.update_column(:sync_status, Document.sync_statuses[:complete])
      tasks = hub.onboarding_tasks
      expect(tasks[:document_synced]).to be true
    end

    it "returns false for document_synced when only pending/error documents exist" do
      source = create(:source, hub: hub)
      create(:document, source: source)
      tasks = hub.onboarding_tasks
      expect(tasks[:document_synced]).to be false
    end

    it "returns true for document_synced even after the synced document is deleted" do
      source = create(:source, hub: hub)
      document = create(:document, source: source)
      document.update_column(:sync_status, Document.sync_statuses[:complete])
      document.destroy!
      tasks = hub.onboarding_tasks
      expect(tasks[:document_synced]).to be true
    end

    it "returns true for internal_conversation_message_received when a message exists in an internal conversation" do
      conversation = create(:conversation, hub: hub, platform: :internal)
      create(:message, :incoming, conversation: conversation)
      tasks = hub.onboarding_tasks
      expect(tasks[:internal_conversation_message_received]).to be true
      expect(tasks[:messaging_platform_connected]).to be false
    end

    it "returns false for internal_conversation_message_received when messages only exist in non-internal conversations" do
      conversation = create(:conversation, :external, hub: hub)
      create(:message, :outgoing, conversation: conversation)
      tasks = hub.onboarding_tasks
      expect(tasks[:internal_conversation_message_received]).to be false
    end

    it "returns true for internal_conversation_message_received even after the message is deleted" do
      conversation = create(:conversation, hub: hub, platform: :internal)
      message = create(:message, :incoming, conversation: conversation)
      message.destroy!
      tasks = hub.onboarding_tasks
      expect(tasks[:internal_conversation_message_received]).to be true
    end

    it "returns true for all tasks when all have been created" do
      source = create(:source, hub: hub)
      create(:document, source: source).update_column(:sync_status, Document.sync_statuses[:complete])
      create(:whatsapp_messaging_integration, hub: hub)
      conversation = create(:conversation, hub: hub, platform: :internal)
      create(:message, :incoming, conversation: conversation)
      tasks = hub.onboarding_tasks
      expect(tasks[:source_created]).to be true
      expect(tasks[:messaging_platform_connected]).to be true
      expect(tasks[:document_synced]).to be true
      expect(tasks[:internal_conversation_message_received]).to be true
    end
  end

  describe "#first_message_for_conversation" do
    let(:hub) { create(:hub) }

    before do
      allow(KnowledgeService).to receive(:preview).with("first_message", anything).and_return("Welcome. TestBot is here to help.")
    end

    it "returns LLM message with disclaimer appended" do
      result = hub.first_message_for_conversation("en")
      expect(result).to include("Welcome. TestBot is here to help.")
      expect(result).to include(I18n.t(:first_message_ai_disclaimer))
    end

    it "calls KnowledgeService.preview with first_message scenario" do
      hub.first_message_for_conversation("en")
      expect(KnowledgeService).to have_received(:preview).with("first_message", anything)
    end

    it "localizes disclaimer to conversation language" do
      result = hub.first_message_for_conversation("es")
      expect(result).to include(I18n.t(:first_message_ai_disclaimer, locale: :es))
    end

    it "generates and caches the message separately for each language" do
      allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::MemoryStore.new)

      2.times { hub.first_message_for_conversation("es") }
      hub.first_message_for_conversation("en")

      expect(KnowledgeService).to have_received(:preview).with("first_message", hash_including(default_language: "es")).once
      expect(KnowledgeService).to have_received(:preview).with("first_message", hash_including(default_language: "en")).once
    end

    it "uses english for an unsupported language" do
      result = hub.first_message_for_conversation("xx")

      expect(KnowledgeService).to have_received(:preview).with("first_message", hash_including(default_language: "en"))
      expect(result).to include(I18n.t(:first_message_ai_disclaimer, locale: :en))
    end
  end

  describe "#closed_message_for_conversation" do
    let(:hub) { create(:hub) }
    let(:cache) { ActiveSupport::Cache::MemoryStore.new }

    before do
      allow(Rails).to receive(:cache).and_return(cache)
      allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything).and_return("Goodbye.")
    end

    it "generates once per language and appends the topics sentence" do
      hub.closed_message_for_conversation("pt", [])
      result = hub.closed_message_for_conversation("pt", ["Climate", "Health"])

      expect(KnowledgeService).to have_received(:preview).once
      expect(result).to eq("Goodbye.\n\n#{I18n.t(:message_closed_window_topics, topics: %w[Climate Health].to_sentence(locale: :pt), locale: :pt)}")
    end

    it "caches each language separately" do
      hub.closed_message_for_conversation("en", [])
      hub.closed_message_for_conversation("pt", [])

      expect(KnowledgeService).to have_received(:preview).twice
    end

    it "uses the english message for an unsupported language" do
      hub.closed_message_for_conversation("xx", [])

      expect(KnowledgeService).to have_received(:preview).with("conversation_closed", hash_including(default_language: "en"))
      expect(cache.exist?("hub/#{hub.id}/conversation_closed/en")).to be true
    end

    it "falls back to the static message and caches nothing when the generated message is blank" do
      allow(KnowledgeService).to receive(:preview).with("conversation_closed", anything).and_return("")

      expect(hub.closed_message_for_conversation("en", [])).to eq(I18n.t(:conversation_inactivity_closing))
      expect(cache.exist?("hub/#{hub.id}/conversation_closed/en")).to be false
    end
  end

  describe "as_json with virtual membership for super-admin" do
    it "returns a virtual hub_membership for a super-admin who is not a member" do
      hub = create(:hub)
      super_admin = create(:user, email: "admin@meedan.com")

      json = hub.as_json(include_hub_membership_for_user_id: super_admin.id)

      expect(json[:hub_membership]).to be_present
      expect(json[:hub_membership][:user_id]).to eq(super_admin.id)
      expect(json[:hub_membership][:approved]).to be true
      expect(json[:hub_membership][:role]).to eq("editor")
      expect(json[:hub_membership][:capabilities]).to be_present
    end
  end

  describe ".user_agent_for" do
    it "formats the crawler User-Agent for a single digit hub id" do
      expect(Hub.user_agent_for(5)).to eq("Suwali/1.0 (Hub 5; +https://suwali.io)")
    end

    it "formats the crawler User-Agent for a multi-digit hub id" do
      expect(Hub.user_agent_for(98765)).to eq("Suwali/1.0 (Hub 98765; +https://suwali.io)")
    end

    it "formats the crawler User-Agent for a nil hub id" do
      expect(Hub.user_agent_for(nil)).to eq("Suwali/1.0 (Hub ; +https://suwali.io)")
    end
  end

  describe "as_json user_agent" do
    it "includes the crawler User-Agent with the hub's own id" do
      hub = create(:hub)

      expect(hub.as_json[:user_agent]).to eq("Suwali/1.0 (Hub #{hub.id}; +https://suwali.io)")
    end
  end

  describe "as_json with onboarding_tasks" do
    let(:hub) { create(:hub) }

    it "does not include onboarding_tasks by default" do
      json = hub.as_json
      expect(json).not_to have_key(:onboarding_tasks)
    end

    it "includes onboarding_tasks when include_onboarding_tasks is true" do
      create(:source, hub: hub)
      json = hub.as_json(include_onboarding_tasks: true)
      expect(json).to have_key(:onboarding_tasks)
      expect(json[:onboarding_tasks][:source_created]).to be true
      expect(json[:onboarding_tasks][:messaging_platform_connected]).to be false
      expect(json[:onboarding_tasks][:document_synced]).to be false
      expect(json[:onboarding_tasks][:internal_conversation_message_received]).to be false
    end
  end

  describe "#personalization_for_knowledge_service" do
    it "sends the chosen tone" do
      hub = build(:hub, bot_attributes: {"tone" => "advocate"})
      expect(hub.personalization_for_knowledge_service[:tone]).to eq("advocate")
    end

    it "sends the default tone when the hub has not chosen one" do
      hub = build(:hub, bot_attributes: {"name" => "Bot"})
      expect(hub.personalization_for_knowledge_service[:tone]).to eq("journalist")
    end

    it "sends the default tone when the hub has no bot attributes" do
      hub = build(:hub, bot_attributes: nil)
      expect(hub.personalization_for_knowledge_service[:tone]).to eq("journalist")
    end

    it "sends each external resource with its type and description" do
      hub = create(:hub)
      create(:external_resource, hub: hub, title: "https://mysurvey.com/submit", resource_type: "link", description: "Answer our survey", scenarios: ["conversation_closed"])

      expect(hub.personalization_for_knowledge_service[:external_resources]).to eq([
        {title: "https://mysurvey.com/submit", resource_type: "link", description: "Answer our survey", scenarios: ["conversation_closed"]}
      ])
    end
  end
end
