require "rails_helper"

RSpec.describe ExternalUser, type: :model do
  it "is valid with valid attributes" do
    user = build(:external_user)
    expect(user).to be_valid
  end

  describe ".with_last_conversation_id" do
    it "returns the id of the most recent conversation" do
      user = create(:external_user)
      create(:conversation, :external, participant: user, updated_at: 1.day.ago)
      newer = create(:conversation, :external, participant: user)
      result = ExternalUser.with_last_conversation_id.find(user.id)
      expect(result.last_conversation_id).to eq(newer.id)
    end

    it "returns nil when the user has no conversations" do
      user = create(:external_user)
      result = ExternalUser.with_last_conversation_id.find(user.id)
      expect(result.last_conversation_id).to be_nil
    end
  end

  it "is valid on the sms platform" do
    user = build(:external_user, platform: "sms", external_id: "+15551234567")
    expect(user).to be_valid
  end

  describe "opt-out" do
    it "is not opted out by default" do
      user = create(:external_user)
      expect(user.opted_out?).to be(false)
    end

    it "records and clears opt-out" do
      user = create(:external_user, platform: "sms", external_id: "+15551234567")

      user.opt_out!
      expect(user.reload.opted_out?).to be(true)

      user.opt_in!
      expect(user.reload.opted_out?).to be(false)
    end

    it "does not overwrite the opt-out timestamp when already opted out" do
      user = create(:external_user, platform: "sms", external_id: "+15551234567")
      user.opt_out!
      original = user.reload.opted_out_at

      user.opt_out!
      expect(user.reload.opted_out_at).to eq(original)
    end
  end

  describe ".find_or_initialize_by_identity" do
    let(:hub) { create(:hub) }

    it "prefers the exact identifier over another spelling of the same number" do
      variant = create(:external_user, hub: hub, platform: "whatsapp", external_id: "5511991234567", messages_count: 50)
      exact = create(:external_user, hub: hub, platform: "whatsapp", external_id: "551191234567", messages_count: 1)

      found = ExternalUser.find_or_initialize_by_identity(hub, "whatsapp", "551191234567")

      expect(found.id).to eq(exact.id)
      expect(found.id).not_to eq(variant.id)
    end

    it "matches another spelling of the same number when no identifier matches exactly" do
      known = create(:external_user, hub: hub, platform: "whatsapp", external_id: "551191234567", messages_count: 40)

      found = ExternalUser.find_or_initialize_by_identity(hub, "whatsapp", "5511991234567")

      expect(found.id).to eq(known.id)
    end

    it "builds a new end-user in the hub when nothing matches" do
      found = ExternalUser.find_or_initialize_by_identity(hub, "whatsapp", "551191234567")

      expect(found).not_to be_persisted
      expect(found).to have_attributes(hub_id: hub.id, external_id: "551191234567")
    end

    it "never matches an end-user belonging to another hub" do
      create(:external_user, hub: create(:hub), platform: "whatsapp", external_id: "551191234567", messages_count: 40)

      found = ExternalUser.find_or_initialize_by_identity(hub, "whatsapp", "5511991234567")

      expect(found).not_to be_persisted
      expect(found.hub_id).to eq(hub.id)
    end
  end

  describe "#effective_display_name" do
    it "returns anonymized name for non-trusted user" do
      user = build(:external_user, display_name: "Real Name", trusted_user: false, platform: "telegram")
      expect(user.effective_display_name).to eq("user-#{user.id}")
    end

    it "returns real display name for trusted user" do
      user = build(:external_user, display_name: "Real Name", trusted_user: true, platform: "telegram")
      expect(user.effective_display_name).to eq("Real Name")
    end

    it "returns anonymized name for trusted user without a display name" do
      user = build(:external_user, display_name: "", trusted_user: true, platform: "telegram")
      expect(user.effective_display_name).to eq("user-#{user.id}")
    end
  end
end
