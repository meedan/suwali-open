require "rails_helper"

RSpec.describe HubDeletionWorker, type: :worker do
  let(:grace_period) { Hub.trial_deletion_grace_period }

  describe "#perform" do
    context "when hub is eligible for deletion" do
      let!(:hub) { create(:hub, plan: :free_unrestricted) }
      let!(:source) { create(:source, hub: hub) }
      let!(:document1) { create(:document, source: source) }
      let!(:document2) { create(:document, source: source) }
      let!(:notebook) { create(:notebook, hub: hub) }
      let!(:conversation) { create(:conversation, hub: hub) }

      # Set trial to expired after creating associated records
      before do
        trial_end = Time.current - grace_period - 1.day
        hub.update_columns(trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      end

      it "destroys the hub" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect {
          described_class.new.perform(hub.id)
        }.to change(Hub, :count).by(-1)

        expect(Hub.find_by(id: hub.id)).to be_nil
      end

      it "deletes all documents via cascade" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        described_class.new.perform(hub.id)

        # Documents should be deleted via cascade from hub -> sources -> documents
        expect(Document.find_by(id: document1.id)).to be_nil
        expect(Document.find_by(id: document2.id)).to be_nil
      end

      it "triggers KnowledgeService cleanup for each document via cascade" do
        allow(LogService).to receive(:log)

        # Each document.destroy triggered by cascade should enqueue KnowledgeServiceWorker
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document1.id, hub.id)
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document2.id, hub.id)

        described_class.new.perform(hub.id)
      end

      it "deletes all associated data" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        described_class.new.perform(hub.id)

        expect(Source.find_by(id: source.id)).to be_nil
        expect(Notebook.find_by(id: notebook.id)).to be_nil
        expect(Conversation.find_by(id: conversation.id)).to be_nil
      end

      it "sends trial_hub_deleted email before destroying" do
        admin = create(:hub_membership, hub: hub, role: :admin).user
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        mailer = double(deliver_later: nil)
        expect(HubMailer).to receive(:trial_hub_deleted).with(admin).and_return(mailer)

        described_class.new.perform(hub.id)
      end

      it "does not send email when trial_emails_enabled is false" do
        create(:hub_membership, hub: hub, role: :admin)
        hub.update_column(:trial_emails_enabled, false)
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(HubMailer).not_to receive(:trial_hub_deleted)

        described_class.new.perform(hub.id)
      end

      it "logs the deletion process" do
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Starting deletion of hub #{hub.id} with 2 documents")
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Successfully deleted hub #{hub.id}")

        described_class.new.perform(hub.id)
      end
    end

    context "when hub is premium" do
      let!(:hub) { create(:hub, plan: :enterprise) }

      it "does not delete the hub" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(Hub, :count)

        expect(Hub.find_by(id: hub.id)).not_to be_nil
      end

      it "logs that hub is not eligible" do
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Hub #{hub.id} is no longer eligible for deletion, skipping")

        described_class.new.perform(hub.id)
      end
    end

    context "when hub is within grace period" do
      let!(:trial_end) { 15.days.ago }
      let!(:hub) { create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end) }

      it "does not delete the hub" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(Hub, :count)

        expect(Hub.find_by(id: hub.id)).not_to be_nil
      end

      it "logs that hub is not eligible" do
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Hub #{hub.id} is no longer eligible for deletion, skipping")

        described_class.new.perform(hub.id)
      end
    end

    context "when hub is flagged for deletion by an admin" do
      let!(:hub) { create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now, deletion_requested_at: Time.current, deletion_requested_by_email: "admin@meedan.com") }

      it "destroys the hub even though the trial is still active" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect {
          described_class.new.perform(hub.id)
        }.to change(Hub, :count).by(-1)

        expect(Hub.find_by(id: hub.id)).to be_nil
      end

      it "does not send the trial_hub_deleted email" do
        create(:hub_membership, hub: hub, role: :admin)
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(HubMailer).not_to receive(:trial_hub_deleted)

        described_class.new.perform(hub.id)
      end

      it "does not destroy the hub if it became premium after being flagged" do
        allow(LogService).to receive(:log)

        hub.update_columns(plan: Hub.plans[:enterprise], trial_started_at: nil, trial_ends_at: nil)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(Hub, :count)

        expect(Hub.find_by(id: hub.id)).not_to be_nil
      end
    end

    context "when hub does not exist" do
      it "logs that hub was not found" do
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Hub 999999 not found, may have already been deleted")

        described_class.new.perform(999999)
      end

      it "does not raise an error" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(999999)
        }.not_to raise_error
      end
    end

    context "when deletion is already in progress" do
      let!(:trial_end) { Time.current - grace_period - 1.day }
      let!(:hub) { create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end, deletion_in_progress: true, deletion_started_at: Time.current) }

      it "does not delete the hub" do
        allow(LogService).to receive(:log)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(Hub, :count)
      end

      it "logs that deletion is already in progress" do
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Hub #{hub.id} deletion already in progress, skipping")

        described_class.new.perform(hub.id)
      end
    end

    context "idempotency" do
      let!(:hub) { create(:hub, plan: :free_unrestricted) }

      before do
        trial_end = Time.current - grace_period - 1.day
        hub.update_columns(trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      end

      it "running twice does not raise an error" do
        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        # First run - deletes the hub
        described_class.new.perform(hub.id)

        # Second run - hub already deleted
        expect {
          described_class.new.perform(hub.id)
        }.not_to raise_error
      end
    end

    context "when hub changes to premium during deletion" do
      let!(:hub) { create(:hub, plan: :free_unrestricted) }

      before do
        trial_end = Time.current - grace_period - 1.day
        hub.update_columns(trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      end

      it "does not delete the hub if it becomes premium before lock is acquired" do
        allow(LogService).to receive(:log)

        # Simulate hub upgrading to premium before deletion
        hub.update!(plan: :enterprise, trial_started_at: nil, trial_ends_at: nil)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(Hub, :count)

        expect(Hub.find_by(id: hub.id)).not_to be_nil
      end
    end

    context "orphaned user deletion" do
      let!(:hub) { create(:hub, plan: :free_unrestricted) }
      let!(:other_hub) { create(:hub, plan: :enterprise) }

      before do
        trial_end = Time.current - grace_period - 1.day
        hub.update_columns(trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
      end

      it "deletes users who were members of only this hub" do
        user = create(:user)
        create(:hub_membership, hub: hub, user: user)

        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect {
          described_class.new.perform(hub.id)
        }.to change(User, :count).by(-1)

        expect(User.find_by(id: user.id)).to be_nil
      end

      it "does not delete users who have memberships in other hubs" do
        user = create(:user)
        create(:hub_membership, hub: hub, user: user)
        create(:hub_membership, hub: other_hub, user: user)

        allow(LogService).to receive(:log)
        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect {
          described_class.new.perform(hub.id)
        }.not_to change(User, :count)

        expect(User.find_by(id: user.id)).not_to be_nil
      end

      it "logs when orphaned users are deleted" do
        user1 = create(:user)
        user2 = create(:user)
        create(:hub_membership, hub: hub, user: user1)
        create(:hub_membership, hub: hub, user: user2)

        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Starting deletion of hub #{hub.id} with 0 documents")
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Deleted 2 orphaned user(s) from hub #{hub.id}")
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Successfully deleted hub #{hub.id}")

        described_class.new.perform(hub.id)
      end

      it "does not log when no orphaned users are deleted" do
        user = create(:user)
        create(:hub_membership, hub: hub, user: user)
        create(:hub_membership, hub: other_hub, user: user)

        allow(KnowledgeServiceWorker).to receive(:perform_in)

        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Starting deletion of hub #{hub.id} with 0 documents")
        expect(LogService).not_to receive(:log).with(:info, "HubDeletionWorker", /orphaned user/)
        expect(LogService).to receive(:log).with(:info, "HubDeletionWorker", "Successfully deleted hub #{hub.id}")

        described_class.new.perform(hub.id)
      end
    end
  end
end
