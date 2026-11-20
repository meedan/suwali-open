require "rails_helper"

RSpec.describe Conversation, type: :model do
  it "is valid with valid attributes" do
    conversation = build(:conversation)
    expect(conversation).to be_valid
  end

  it "is invalid without a title" do
    conversation = build(:conversation, title: nil)
    expect(conversation).not_to be_valid
  end

  describe "#recently_active?" do
    let(:conversation) { create(:conversation, platform: "telegram") }

    it "is false when there are no messages" do
      expect(conversation.recently_active?).to be(false)
    end

    it "is true when the user sent a message within the timeout" do
      create(:message, :incoming, conversation: conversation)
      expect(conversation.recently_active?).to be(true)
    end

    it "is false when only outgoing messages are recent" do
      create(:message, :outgoing, conversation: conversation)
      expect(conversation.recently_active?).to be(false)
    end

    it "is false when the user's last message is older than the timeout" do
      create(:message, :incoming, conversation: conversation, created_at: Conversation.inactivity_timeout.ago - 1.minute)
      expect(conversation.recently_active?).to be(false)
    end

    it "is true when there was incoming activity within the timeout before the given as_of time" do
      create(:message, :incoming, conversation: conversation, created_at: 1.hour.ago)
      expect(conversation.recently_active?(as_of: 1.hour.ago + 5.minutes)).to be(true)
    end

    it "is false when the only incoming activity is the message being excluded" do
      message = create(:message, :incoming, conversation: conversation)
      expect(conversation.recently_active?(as_of: message.created_at, excluding: message)).to be(false)
    end

    it "is true when another incoming message is within the window, even if the given message is excluded" do
      create(:message, :incoming, conversation: conversation, created_at: 1.minute.ago)
      later = create(:message, :incoming, conversation: conversation)
      expect(conversation.recently_active?(as_of: later.created_at, excluding: later)).to be(true)
    end

    it "is false when the incoming activity is older than the timeout relative to as_of" do
      create(:message, :incoming, conversation: conversation, created_at: 1.hour.ago - Conversation.inactivity_timeout)
      expect(conversation.recently_active?(as_of: 1.hour.ago)).to be(false)
    end
  end

  describe "#substantive_reply_since?" do
    let(:conversation) { create(:conversation, platform: "telegram") }

    it "is false when there are no messages after the given time" do
      expect(conversation.substantive_reply_since?(1.minute.ago)).to be(false)
    end

    it "is true when there is a real outgoing reply after the given time" do
      reply = create(:message, direction: "outgoing", conversation: conversation)
      expect(conversation.substantive_reply_since?(reply.created_at - 1.minute)).to be(true)
    end

    it "is false when the only message after the given time is a contribution-flow message" do
      time = 1.minute.ago
      create(:message, direction: "outgoing", conversation: conversation, state: :bot_contribution_started)
      expect(conversation.substantive_reply_since?(time)).to be(false)
    end

    it "is false when the only outgoing message is before the given time" do
      reply = create(:message, direction: "outgoing", conversation: conversation)
      expect(conversation.substantive_reply_since?(reply.created_at + 1.minute)).to be(false)
    end
  end

  it "is invalid without a platform" do
    conversation = build(:conversation, platform: nil)
    expect(conversation).not_to be_valid
  end

  it "requires a User-type participant for internal conversations" do
    conversation = build(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
    expect(conversation).to be_valid
    conversation = build(:conversation, participant: build(:organization), platform: "internal")
    expect(conversation).not_to be_valid
  end

  it "is invalid with invalid platform" do
    expect {
      build(:conversation, platform: "smoke_signal")
    }.to raise_error(ArgumentError)
  end

  it "belongs to a hub" do
    hub = create(:hub)
    conversation = create(:conversation, hub: hub)
    expect(conversation.hub).to eq(hub)
  end

  it "can be a notebook item" do
    hub = build(:hub)
    conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), hub: hub)
    notebook = create(:notebook, hub: hub)
    notebook.conversations << conversation
    expect(conversation.reload.notebooks.to_a).to eq([notebook])
  end

  it "renames existing title with counter" do
    hub = create(:hub)
    user = create(:user, email: Faker::Internet.email)
    conversation = create(:conversation, title: "Foo", participant: user, hub: hub)
    expect(conversation.title).to eq("Foo")
    conversation = create(:conversation, title: "Foo", participant: user, hub: hub)
    expect(conversation.title).to eq("Foo [1]")
    conversation = create(:conversation, title: "Foo", participant: user, hub: hub)
    expect(conversation.title).to eq("Foo [2]")
    conversation = create(:conversation, title: "Foo", participant: user)
    expect(conversation.title).to eq("Foo")
    conversation = create(:conversation, title: "Foo", hub: hub)
    expect(conversation.title).to eq("Foo")
    conversation = create(:conversation, title: "Foo")
    expect(conversation.title).to eq("Foo")
  end

  describe "#text_for_summarization" do
    it "returns empty string when there are no messages" do
      conversation = create(:conversation)
      expect(conversation.text_for_summarization).to eq("")
    end

    it "returns JSON of message history when messages exist" do
      conversation = create(:conversation)
      create(:message, conversation: conversation, direction: "incoming", body: "Hello")
      create(:message, conversation: conversation, direction: "outgoing", body: "Hi there")

      text = conversation.text_for_summarization
      expect(text).to be_a(String)
      parsed = JSON.parse(text)
      expect(parsed).to be_an(Array)
      expect(parsed.first["content"]).to eq("Hello")
    end
  end

  describe "#summarizable?" do
    it "is true when ai_summary is present" do
      conversation = create(:conversation, ai_summary: "Summary")
      expect(conversation.summarizable?).to be(true)
    end

    it "is true when it has messages" do
      conversation = create(:conversation)
      create(:message, conversation: conversation, direction: "incoming")

      expect(conversation.summarizable?).to be(true)
    end

    it "is false when it has no ai_summary and no messages" do
      conversation = create(:conversation)
      expect(conversation.summarizable?).to be(false)
    end
  end

  describe "#deletable_by?" do
    it "is true for the participant of an internal conversation" do
      user = create(:user)
      conversation = create(:conversation, participant: user)

      expect(conversation.deletable_by?(user)).to be(true)
    end

    it "is false for a write super admin who is not the participant of an internal conversation" do
      write_super_admin = create(:user, email: "super@meedan.com", admin_write_access: true)
      conversation = create(:conversation, participant: create(:user))

      expect(conversation.deletable_by?(write_super_admin)).to be(false)
    end

    it "is true for a write super admin on an external conversation" do
      write_super_admin = create(:user, email: "super@meedan.com", admin_write_access: true)
      conversation = create(:conversation, :external)

      expect(conversation.deletable_by?(write_super_admin)).to be(true)
    end

    it "is false for a read-only super admin on an external conversation" do
      read_only_super_admin = create(:user, email: "readonly@meedan.com", admin_write_access: false)
      conversation = create(:conversation, :external)

      expect(conversation.deletable_by?(read_only_super_admin)).to be(false)
    end

    it "is false for a regular user on an external conversation" do
      user = create(:user)
      conversation = create(:conversation, :external)

      expect(conversation.deletable_by?(user)).to be(false)
    end
  end

  describe "soft delete" do
    it "has a not_deleted scope" do
      active_conversation = create(:conversation)
      deleted_conversation = create(:conversation, deleted_at: Time.current)

      expect(Conversation.not_deleted).to include(active_conversation)
      expect(Conversation.not_deleted).not_to include(deleted_conversation)
    end

    it "can be created as deleted" do
      conversation = create(:conversation, deleted_at: Time.current)

      expect(conversation.readonly?).to be true
      expect(conversation.deleted?).to be true
    end

    it "is readonly when deleted" do
      conversation = create(:conversation)
      expect(conversation.readonly?).to be false
      expect(conversation.deleted?).to be false

      conversation.update!(deleted_at: Time.current)
      expect(conversation.readonly?).to be true
      expect(conversation.deleted?).to be true
    end

    it "prevents updates when deleted" do
      conversation = create(:conversation)
      conversation.update!(deleted_at: Time.current)

      expect { conversation.update!(title: "New Title") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    end
  end

  describe "#destroy_orphaned_external_participant" do
    it "destroys the external user when their only conversation is destroyed" do
      conversation = create(:conversation, :external)
      external_user = conversation.participant

      conversation.destroy!

      expect(ExternalUser.where(id: external_user.id)).not_to exist
    end

    it "keeps the external user when they have other conversations" do
      conversation = create(:conversation, :external)
      external_user = conversation.participant
      create(:conversation, :external, hub: conversation.hub, participant: external_user, platform: "whatsapp")

      conversation.destroy!

      expect(ExternalUser.where(id: external_user.id)).to exist
    end

    it "keeps the user when an internal conversation is destroyed" do
      conversation = create(:conversation)
      user = conversation.participant

      conversation.destroy!

      expect(User.where(id: user.id)).to exist
    end
  end

  describe "#set_default_language" do
    it "sets language to 'en' by default" do
      conversation = create(:conversation)
      expect(conversation.language).to eq("en")
    end

    it "uses hub's default_language from bot_attributes" do
      hub = create(:hub, bot_attributes: {"default_language" => "pt"})
      conversation = create(:conversation, hub: hub)
      expect(conversation.language).to eq("pt")
    end

    it "does not override an explicitly set language" do
      hub = create(:hub, bot_attributes: {"default_language" => "pt"})
      conversation = create(:conversation, hub: hub, language: "es")
      expect(conversation.language).to eq("es")
    end
  end

  describe "#update_language" do
    it "updates the language when the new language differs" do
      conversation = create(:conversation)
      conversation.update_language("pt")
      expect(conversation.reload.language).to eq("pt")
    end

    it "does nothing when language is the same" do
      conversation = create(:conversation, language: "en")
      expect { conversation.update_language("en") }.not_to change { conversation.reload.language }
    end

    it "does nothing when new language is blank" do
      conversation = create(:conversation, language: "en")
      conversation.update_language("")
      expect(conversation.reload.language).to eq("en")
    end

    it "allows updating when no supported_languages restriction is configured" do
      hub = create(:hub, bot_attributes: {})
      conversation = create(:conversation, hub: hub)
      conversation.update_language("fr")
      expect(conversation.reload.language).to eq("fr")
    end

    it "allows updating when language is in supported_languages" do
      hub = create(:hub, bot_attributes: {"supported_languages" => ["en", "pt", "fr"]})
      conversation = create(:conversation, hub: hub)
      conversation.update_language("pt")
      expect(conversation.reload.language).to eq("pt")
    end

    it "rejects updating when language is not in supported_languages" do
      hub = create(:hub, bot_attributes: {"supported_languages" => ["en", "pt"]})
      conversation = create(:conversation, hub: hub)
      conversation.update_language("fr")
      expect(conversation.reload.language).to eq("en")
    end
  end

  describe "#apply_context_updates!" do
    let(:conversation) { create(:conversation, context: [{"id" => "n1", "text" => "Lives in Nairobi"}]) }
    let(:message) { create(:message, :incoming, conversation: conversation) }

    it "replaces a note with a remove plus an add" do
      conversation.apply_context_updates!([{"op" => "remove", "id" => "n1"}, {"op" => "add", "text" => "Lives in Lagos"}], message)

      expect(conversation.reload.context).to match([hash_including("text" => "Lives in Lagos", "message_id" => message.id)])
      expect(message.reload.metadata["context_updates"]).to eq([{"op" => "remove", "text" => "Lives in Nairobi"}, {"op" => "add", "text" => "Lives in Lagos"}])
    end

    it "keeps the newest message's note even when its callback arrives first" do
      older_message = create(:message, :incoming, conversation: conversation)
      newer_message = create(:message, :incoming, conversation: conversation)
      conversation.apply_context_updates!([{"op" => "add", "text" => "Lives in Abuja"}], newer_message)
      conversation.apply_context_updates!([{"op" => "add", "text" => "Lives in Lagos"}], older_message)

      expect(conversation.reload.context.map { |note| note["text"] }).to eq(["Lives in Abuja"])
      expect(older_message.reload.metadata.to_h).not_to have_key("context_updates")
    end

    it "ignores blank, too long, and duplicate adds and removes of unknown ids" do
      updates = [
        {"op" => "remove", "id" => "unknown"},
        {"op" => "add", "text" => " "},
        {"op" => "add", "text" => "x" * 201},
        {"op" => "add", "text" => "lives in nairobi"}
      ]

      expect { conversation.apply_context_updates!(updates, message) }.not_to change { conversation.reload.context }
    end
  end

  describe "trial restrictions" do
    it "allows creating conversation on premium hub" do
      hub = create(:hub, plan: :enterprise)
      conversation = build(:conversation, hub: hub)
      expect(conversation).to be_valid
    end

    it "allows creating conversation on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      conversation = build(:conversation, hub: hub)
      expect(conversation).to be_valid
    end

    it "rejects creating conversation on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      conversation = build(:conversation, hub: hub)
      expect(conversation).not_to be_valid
      expect(conversation.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "rejects creating conversation on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      conversation = build(:conversation, hub: hub)
      expect(conversation).not_to be_valid
      expect(conversation.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end

  describe ".ordered_by_participant_name" do
    let(:hub) { create(:hub) }

    def converse(participant)
      create(:conversation, hub: hub, participant: participant, platform: participant.is_a?(User) ? 0 : 1)
    end

    def external(id: nil, name: "", trusted: true)
      create(:external_user, id: id, hub: hub, external_id: "e#{id || name}", display_name: name, trusted_user: trusted)
    end

    it "orders by the name shown, across external users and team members" do
      zed = converse(external(name: "Zed"))
      amy = converse(create(:user, name: "amy", email: "amy@example.com"))
      bob = converse(external(name: "Bob"))
      cleo = converse(create(:user, name: "", email: "cleo@example.com"))

      expect(hub.conversations.ordered_by_participant_name("asc")).to eq([amy, bob, cleo, zed])
      expect(hub.conversations.ordered_by_participant_name("desc")).to eq([zed, cleo, bob, amy])
    end

    it "shows untrusted or unnamed external users as user-<id>, in numeric id order" do
      ten_digits = converse(external(id: 100_000_001, name: "Hidden", trusted: false))
      nine_digits = converse(external(id: 90_000_001))

      expect(hub.conversations.ordered_by_participant_name("asc")).to eq([nine_digits, ten_digits])
    end
  end

  describe ".current_for" do
    let(:conversation) { create(:conversation, :external) }

    it "finds the participant's conversation on that platform" do
      expect(Conversation.current_for(conversation.participant, conversation.platform)).to eq([conversation])
    end

    it "ignores other platforms" do
      other_platform = (AppInfo::PLATFORMS.keys.map(&:to_s) - [conversation.platform]).first

      expect(Conversation.current_for(conversation.participant, other_platform)).to be_empty
    end

    it "ignores other participants" do
      other = create(:conversation, :external)

      expect(Conversation.current_for(conversation.participant, conversation.platform)).not_to include(other)
    end

    it "ignores soft-deleted conversations" do
      conversation.update!(deleted_at: Time.current)

      expect(Conversation.current_for(conversation.participant, conversation.platform)).to be_empty
    end
  end

  describe ".listed_for" do
    let(:hub) { create(:hub) }
    let(:viewer) { create(:hub_membership, hub: hub).user }

    def conversation_with(participant)
      create(:conversation, hub: hub, participant: participant)
    end

    it "includes conversations of approved hub members" do
      member_conversation = conversation_with(create(:hub_membership, hub: hub).user)

      expect(Conversation.listed_for(viewer)).to include(member_conversation)
    end

    it "excludes conversations of users who are not hub members" do
      non_member_conversation = conversation_with(create(:user))

      expect(Conversation.listed_for(viewer)).not_to include(non_member_conversation)
    end

    it "excludes conversations of users whose hub membership is not approved" do
      unapproved_conversation = conversation_with(create(:hub_membership, :unapproved, hub: hub).user)

      expect(Conversation.listed_for(viewer)).not_to include(unapproved_conversation)
    end

    it "excludes conversations of users who are members of another hub only" do
      other_hub_member_conversation = conversation_with(create(:hub_membership).user)

      expect(Conversation.listed_for(viewer)).not_to include(other_hub_member_conversation)
    end

    it "includes conversations of external users" do
      external_conversation = create(:conversation, :external, hub: hub)

      expect(Conversation.listed_for(viewer)).to include(external_conversation)
    end

    it "includes conversations of non-members for super admins" do
      super_admin = create(:user, email: "admin@meedan.com")
      non_member_conversation = conversation_with(create(:user))

      expect(Conversation.listed_for(super_admin)).to include(non_member_conversation)
    end
  end

  describe ".readable_by" do
    let(:hub) { create(:hub) }
    let(:viewer) { create(:hub_membership, hub: hub).user }

    it "includes listed conversations in the viewer's hubs" do
      member_conversation = create(:conversation, hub: hub, participant: create(:hub_membership, hub: hub).user)

      expect(Conversation.readable_by(viewer)).to include(member_conversation)
    end

    it "excludes conversations hidden from the viewer's hub list" do
      non_member_conversation = create(:conversation, hub: hub, participant: create(:user))

      expect(Conversation.readable_by(viewer)).not_to include(non_member_conversation)
    end

    it "excludes conversations in hubs the viewer doesn't belong to" do
      other_hub_conversation = create(:conversation, :external)

      expect(Conversation.readable_by(viewer)).not_to include(other_hub_conversation)
    end

    it "excludes conversations in hubs where the viewer's membership is not approved" do
      unapproved_viewer = create(:hub_membership, :unapproved, hub: hub).user
      external_conversation = create(:conversation, :external, hub: hub)

      expect(Conversation.readable_by(unapproved_viewer)).not_to include(external_conversation)
    end

    it "includes hidden conversations in any hub for super admins" do
      super_admin = create(:user, email: "admin@meedan.com")
      non_member_conversation = create(:conversation, participant: create(:user))

      expect(Conversation.readable_by(super_admin)).to include(non_member_conversation)
    end
  end
end
