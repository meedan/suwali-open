require "rails_helper"

RSpec.describe HubMailer, type: :mailer do
  describe "join_request" do
    let(:hub) { create(:hub) }
    let!(:admin_membership) { create(:hub_membership, hub: hub, role: :admin) }
    let(:admin_email) { hub.admins.first.email }
    let(:user) { create(:user) }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends join request email to hub admins" do
      mail = HubMailer.join_request(hub, user)

      expect(mail.to).to eq([admin_email])
      expect(mail.subject).to match(/New join request/i)
      expect(mail.body.encoded).to include(hub.name)
      expect(mail.body.encoded).to include(
        "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/dashboard?hubSettings=team"
      )
    end
  end

  describe "join_with_invite_code" do
    let(:hub) { create(:hub) }
    let!(:admin_membership) { create(:hub_membership, hub: hub, role: :admin) }
    let(:admin_email) { hub.admins.first.email }
    let(:user) { create(:user) }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends join with invite code email to hub admins" do
      mail = HubMailer.join_with_invite_code(hub, user)

      expect(mail.to).to eq([admin_email])
      expect(mail.subject).to match(/A new editor has joined/i)
      expect(mail.body.encoded).to include(hub.name)
      expect(mail.body.encoded).to include(
        "#{ENV.fetch("FRONTEND_URL", "http://localhost:5173")}/dashboard?hubSettings=team"
      )
    end
  end

  describe "welcome_new_member" do
    let(:hub) { create(:hub) }
    let(:user) { create(:user) }

    before do
      ActionMailer::Base.deliveries.clear
    end

    it "sends welcome email to new member" do
      mail = HubMailer.welcome_new_member(hub, user)

      expect(mail.to).to eq([user.email])
      expect(mail.subject).to match(/Welcome to #{hub.name}/i)
      expect(mail.body.encoded).to include(hub.name)
      expect(mail.body.encoded).to include(ENV.fetch("FRONTEND_URL", "http://localhost:5173"))
    end
  end

  describe "trial emails" do
    let(:user) { create(:user, name: "Jane") }
    let(:support_email) { ENV.fetch("SUPPORT_EMAIL", "support@suwali.io") }
    let(:demo_link) { AppInfo.schedule_demo_link }

    before do
      ActionMailer::Base.deliveries.clear
    end

    describe "trial_welcome" do
      it "sends to user with correct subject and body" do
        mail = HubMailer.trial_welcome(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_welcome_subject"))
        expect(mail.body.encoded).to include("Jane")
        expect(mail.body.encoded).to include(support_email)
        expect(mail.body.encoded).to include(demo_link)
      end
    end

    describe "trial_halfway" do
      it "sends to user with correct subject and body" do
        mail = HubMailer.trial_halfway(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_halfway_subject"))
        expect(mail.body.encoded).to include("Jane")
        expect(mail.body.encoded).to include("suwali.io/resources/#set-up-personalization")
      end
    end

    describe "trial_one_week_left" do
      it "sends to user with correct subject and body" do
        mail = HubMailer.trial_one_week_left(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_one_week_left_subject"))
        expect(mail.body.encoded).to include("suwali.io/resources/#connect-whatsapp")
      end
    end

    describe "trial_three_days_left" do
      it "sends to user with correct subject and body" do
        mail = HubMailer.trial_three_days_left(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_three_days_left_subject"))
        expect(mail.body.encoded).to include("read only experience")
      end
    end

    describe "trial_ends_tomorrow" do
      it "sends to user with correct subject and body" do
        mail = HubMailer.trial_ends_tomorrow(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_ends_tomorrow_subject"))
        expect(mail.body.encoded).to include("ends tomorrow")
      end
    end

    describe "trial_hub_deleted" do
      it "sends to user with correct subject and no greeting" do
        mail = HubMailer.trial_hub_deleted(user)

        expect(mail.to).to eq([user.email])
        expect(mail.subject).to eq(I18n.t("mailer_hub_trial_hub_deleted_subject"))
        expect(mail.body.encoded).to include("has been removed")
        expect(mail.body.encoded).not_to include("Jane")
      end
    end

    it "sends from SALES_EMAIL_FROM" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("SALES_EMAIL_FROM", anything).and_return("sales@suwali.io")

      mail = HubMailer.trial_welcome(user)
      expect(mail.from).to eq(["sales@suwali.io"])
    end

    it "falls back to email when user has no name" do
      user_no_name = create(:user, name: "")
      mail = HubMailer.trial_welcome(user_no_name)

      expect(mail.body.encoded).to include(user_no_name.email)
    end
  end
end
