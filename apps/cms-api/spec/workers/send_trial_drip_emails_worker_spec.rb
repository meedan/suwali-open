require "rails_helper"

RSpec.describe SendTrialDripEmailsWorker, type: :worker do
  let(:trial_length) { 30.days }
  let(:trial_start) { Time.current }
  let(:trial_end) { trial_start + trial_length }
  let!(:hub) { create(:hub, plan: :free, trial_started_at: trial_start, trial_ends_at: trial_end) }
  let!(:admin_membership) { create(:hub_membership, hub: hub, role: :admin) }
  let(:admin) { admin_membership.user }
  let(:mailer) { double(deliver_later: nil) }

  describe "#perform" do
    context "halfway milestone" do
      it "sends halfway email when past the midpoint" do
        expect(HubMailer).to receive(:trial_halfway).with(admin).and_return(mailer)

        travel_to(trial_start + 16.days) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).to include("trial_halfway")
      end

      it "does not send halfway email before the midpoint" do
        expect(HubMailer).not_to receive(:trial_halfway)

        travel_to(trial_start + 14.days) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).not_to include("trial_halfway")
      end
    end

    context "one week left milestone" do
      it "sends one_week_left email when 7 days remain" do
        expect(HubMailer).to receive(:trial_one_week_left).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_halfway).and_return(mailer)

        travel_to(trial_end - 7.days) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).to include("trial_one_week_left")
      end

      it "does not send one_week_left email when 8 days remain" do
        expect(HubMailer).not_to receive(:trial_one_week_left)
        allow(HubMailer).to receive(:trial_halfway).and_return(mailer)

        travel_to(trial_end - 8.days) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).not_to include("trial_one_week_left")
      end
    end

    context "three days left milestone" do
      it "sends three_days_left email when 3 days remain" do
        expect(HubMailer).to receive(:trial_three_days_left).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_halfway).and_return(mailer)
        allow(HubMailer).to receive(:trial_one_week_left).and_return(mailer)

        travel_to(trial_end - 3.days) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).to include("trial_three_days_left")
      end
    end

    context "ends tomorrow milestone" do
      it "sends ends_tomorrow email when 1 day remains" do
        expect(HubMailer).to receive(:trial_ends_tomorrow).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_halfway).and_return(mailer)
        allow(HubMailer).to receive(:trial_one_week_left).and_return(mailer)
        allow(HubMailer).to receive(:trial_three_days_left).and_return(mailer)

        travel_to(trial_end - 1.day) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).to include("trial_ends_tomorrow")
      end
    end

    context "idempotency" do
      it "does not send an email that was already sent" do
        hub.update_column(:trial_emails_sent, ["trial_halfway"])
        expect(HubMailer).not_to receive(:trial_halfway)
        allow(HubMailer).to receive(:trial_one_week_left).and_return(mailer)

        travel_to(trial_end - 7.days) do
          described_class.new.perform
        end
      end
    end

    context "when trial_emails_enabled is false" do
      before { hub.update_columns(trial_emails_enabled: false, trial_emails_sent: []) }

      it "skips the hub entirely" do
        expect(HubMailer).not_to receive(:trial_ends_tomorrow)

        travel_to(trial_end - 1.day) do
          described_class.new.perform
        end

        expect(hub.reload.trial_emails_sent).to be_empty
      end
    end

    context "when trial has expired" do
      let(:trial_start) { 31.days.ago }
      let(:trial_end) { 1.day.ago }

      it "does not process the hub" do
        expect(HubMailer).not_to receive(:trial_ends_tomorrow)

        described_class.new.perform
      end
    end

    context "with a premium hub" do
      let!(:premium_hub) { create(:hub, plan: :enterprise) }
      let!(:premium_admin) { create(:hub_membership, hub: premium_hub, role: :admin).user }

      it "does not send emails to premium hub admins" do
        allow(HubMailer).to receive(:trial_halfway).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_one_week_left).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_three_days_left).with(admin).and_return(mailer)
        allow(HubMailer).to receive(:trial_ends_tomorrow).with(admin).and_return(mailer)

        expect(HubMailer).not_to receive(:trial_ends_tomorrow).with(premium_admin)

        travel_to(trial_end - 1.day) do
          described_class.new.perform
        end
      end
    end
  end
end
