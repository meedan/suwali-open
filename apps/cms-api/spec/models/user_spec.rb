require "rails_helper"

RSpec.describe User, type: :model do
  it "is valid with valid attributes" do
    user = create(:user)
    expect(user).to be_valid
  end

  it "is invalid without email" do
    user = build(:user, email: nil)
    expect(user).not_to be_valid
  end

  it "has hubs" do
    user = create(:user)
    hub = create(:hub)
    expect {
      user.hubs << hub
    }.to change { HubMembership.count }.by(1)
    expect(user.hubs).to eq([hub])
  end

  describe "#is_admin" do
    it "returns true for @meedan.com email" do
      user = build(:user, email: "admin@meedan.com")
      expect(user.is_admin).to be true
    end

    it "returns true for @meedan.org email" do
      user = build(:user, email: "admin@meedan.org")
      expect(user.is_admin).to be true
    end

    it "returns false for other email domains" do
      user = build(:user, email: "user@example.com")
      expect(user.is_admin).to be false
    end

    it "returns false for nil email" do
      user = build(:user, email: nil)
      expect(user.is_admin).to be false
    end

    it "returns false when a meedan address is only one line of a multi-line email" do
      user = build(:user, email: "admin@meedan.com\nattacker@evil.test")
      expect(user.is_admin).to be false
    end

    it "returns false for a meedan address with a trailing newline" do
      user = build(:user, email: "admin@meedan.com\n")
      expect(user.is_admin).to be false
    end
  end

  describe "#is_write_admin" do
    it "returns true for @meedan.com email with admin_write_access flag set" do
      user = build(:user, email: "admin@meedan.com", admin_write_access: true)
      expect(user.is_write_admin).to be true
    end

    it "returns true for @meedan.org email with admin_write_access flag set" do
      user = build(:user, email: "admin@meedan.org", admin_write_access: true)
      expect(user.is_write_admin).to be true
    end

    it "returns false for @meedan.com email without admin_write_access flag" do
      user = build(:user, email: "admin@meedan.com", admin_write_access: false)
      expect(user.is_write_admin).to be false
    end

    it "returns false for non-meedan email even with admin_write_access flag set" do
      user = build(:user, email: "user@example.com", admin_write_access: true)
      expect(user.is_write_admin).to be false
    end

    it "returns false for nil email" do
      user = build(:user, email: nil, admin_write_access: true)
      expect(user.is_write_admin).to be false
    end

    it "defaults admin_write_access to false for new users" do
      user = create(:user)
      expect(user.admin_write_access).to be false
    end
  end

  describe "activity tracking" do
    it "records both timestamps on login" do
      user = create(:user, last_login_at: nil, last_active_at: nil)

      user.track_login!

      expect(user.reload.last_login_at).to be_within(5.seconds).of(Time.current)
      expect(user.last_active_at).to be_within(5.seconds).of(Time.current)
    end

    it "leaves last_login_at alone when only activity is recorded" do
      user = create(:user, last_login_at: 3.days.ago, last_active_at: 3.days.ago)
      login_at = user.last_login_at

      user.track_activity!

      expect(user.reload.last_active_at).to be_within(5.seconds).of(Time.current)
      expect(user.last_login_at).to be_within(1.second).of(login_at)
    end

    it "does not bump updated_at, so activity never looks like a profile change" do
      user = create(:user, updated_at: 3.days.ago)
      updated_at = user.updated_at

      user.track_activity!

      expect(user.reload.updated_at).to be_within(1.second).of(updated_at)
    end

    it "is stale once the throttle window has passed, and not before" do
      expect(build(:user, last_active_at: nil)).to be_activity_stale
      expect(build(:user, last_active_at: (User::ACTIVITY_THROTTLE + 1.minute).ago)).to be_activity_stale
      expect(build(:user, last_active_at: 1.minute.ago)).not_to be_activity_stale
    end

    # The audit trigger logs a full copy of the row on every UPDATE, so frequent
    # activity writes would bury every real change in audit.users_log.
    it "writes no audit row for an activity update, but still logs real changes" do
      user = create(:user)
      count = -> { ActiveRecord::Base.connection.select_value("SELECT COUNT(*) FROM audit.users_log").to_i }

      expect { user.track_activity! }.not_to change(&count)
      expect { user.track_login! }.not_to change(&count)
      expect { user.update!(name: "Renamed") }.to change(&count).by(1)
      expect { user.update_columns(name: "Again", last_active_at: 1.day.ago) }.to change(&count).by(1)
    end

    # Keeps the skip scoped to activity writes. Without this the trigger would
    # also stop logging no-op updates on every other audited table, where a real
    # change to an unconstrained numeric column can compare equal as jsonb.
    it "still logs an update that changed nothing" do
      user = create(:user)
      count = -> { ActiveRecord::Base.connection.select_value("SELECT COUNT(*) FROM audit.users_log").to_i }

      expect {
        ActiveRecord::Base.connection.execute("UPDATE users SET name = name WHERE id = #{user.id}")
      }.to change(&count).by(1)
    end
  end

  describe ".inactive" do
    it "returns users whose last activity is older than the threshold" do
      inactive = create(:user, last_active_at: (User::INACTIVITY_THRESHOLD + 1.day).ago)
      active = create(:user, last_active_at: 1.day.ago)

      expect(User.inactive).to include(inactive)
      expect(User.inactive).not_to include(active)
    end

    it "falls back to created_at so a user who has never been active is only listed once the threshold passes" do
      never_active_new = create(:user, last_active_at: nil, created_at: 1.day.ago)
      never_active_old = create(:user, last_active_at: nil, created_at: (User::INACTIVITY_THRESHOLD + 1.day).ago)

      expect(User.inactive).to include(never_active_old)
      expect(User.inactive).not_to include(never_active_new)
    end

    it "accepts a different cutoff" do
      user = create(:user, last_active_at: 2.days.ago)

      expect(User.inactive(1.day.ago)).to include(user)
      expect(User.inactive(3.days.ago)).not_to include(user)
    end
  end

  describe "password complexity" do
    # The policy applies to the whole password, not to each line of it: a multi-line
    # password used to be checked one line at a time and rejected even when compliant.
    it "accepts a compliant password whose character classes are split across lines" do
      password = "abcdefg\n1\n!"
      user = build(:user, password: password, password_confirmation: password)
      expect(user).to be_valid
    end

    it "rejects a password with no digit" do
      user = build(:user, password: "Password!", password_confirmation: "Password!")
      expect(user).not_to be_valid
      expect(user.errors[:base]).to include(I18n.t(:error_password_strength))
    end
  end
end
