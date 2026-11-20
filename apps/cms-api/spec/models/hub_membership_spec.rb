require "rails_helper"

RSpec.describe HubMembership, type: :model do
  it "is valid with valid attributes" do
    hub_membership = build(:hub_membership)
    expect(hub_membership).to be_valid
  end

  it "creates default data on create" do
    user = create(:user)
    hub = create(:hub)
    expect {
      HubMembership.create! user: user, hub: hub
    }.to change(Notebook, :count).by(1)
      .and change(Conversation, :count).by(1)
  end

  it "refreshes hub invite code when membership is deleted" do
    hub = create(:hub)
    hub_membership = create(:hub_membership, hub: hub)
    old_code = hub.invite_code
    hub_membership.destroy!
    expect(hub.reload.invite_code).not_to eq(old_code)
  end

  it "returns onboarding tasks as boolean fields" do
    user = create(:user, name: "")
    hub = create(:hub)
    hub_membership = HubMembership.create! user: user, hub: hub

    # Everything starts "false"
    expect(hub_membership.onboarding_tasks[:profile_filled]).to eq(false)
    expect(hub_membership.onboarding_tasks[:internal_conversation_started]).to eq(false)
    expect(hub_membership.onboarding_tasks[:multiple_notebooks_created]).to eq(false)
    expect(hub_membership.onboarding_tasks[:notebook_published]).to eq(false)

    # Perform onboarding tasks
    user.name = "User Name"
    user.save!
    create(:message, direction: :incoming, conversation: create(:conversation, participant: user, hub: hub))
    create(:notebook, user: user, hub: hub)
    notebook = Notebook.where(hub: hub, user: user).first
    notebook.published = true
    notebook.summary = "Test"
    notebook.save!

    # Everything becomes "true"
    hub_membership.reload
    expect(hub_membership.onboarding_tasks[:profile_filled]).to eq(true)
    expect(hub_membership.onboarding_tasks[:internal_conversation_started]).to eq(true)
    expect(hub_membership.onboarding_tasks[:multiple_notebooks_created]).to eq(true)
    expect(hub_membership.onboarding_tasks[:notebook_published]).to eq(true)
  end

  describe "approval" do
    it "defaults to approved" do
      membership = create(:hub_membership)
      expect(membership.approved).to be true
    end

    it "can be created as unapproved" do
      membership = create(:hub_membership, approved: false)
      expect(membership.approved).to be false
    end

    describe "email notifications" do
      it "sends welcome email when membership is approved" do
        membership = create(:hub_membership, approved: false)
        mailer = double(deliver_later: nil)
        expect(HubMailer).to receive(:welcome_new_member).with(membership.hub, membership.user).and_return(mailer)
        membership.update!(approved: true)
      end

      it "does not send welcome email when approved changes from true to false" do
        membership = create(:hub_membership, approved: true)
        expect(HubMailer).not_to receive(:welcome_new_member)
        membership.update!(approved: false)
      end

      it "does not notify admins if new user is added as admin (upon new hub creation)" do
        expect(HubMailer).not_to receive(:join_with_invite_code)
        create(:hub_membership, role: :admin, approved: true)
      end
    end

    describe "scopes" do
      let(:hub) { create(:hub) }
      let!(:approved_membership) { create(:hub_membership, hub: hub, approved: true) }
      let!(:unapproved_membership) { create(:hub_membership, hub: hub, approved: false) }

      it "filters approved memberships" do
        expect(HubMembership.approved).to include(approved_membership)
        expect(HubMembership.approved).not_to include(unapproved_membership)
      end

      it "filters pending approval memberships" do
        expect(HubMembership.pending_approval).to include(unapproved_membership)
        expect(HubMembership.pending_approval).not_to include(approved_membership)
      end
    end
  end
end
