require "rails_helper"

RSpec.describe EnqueueExpiredTrialHubDeletionsWorker, type: :worker do
  let(:grace_period) { Hub.trial_deletion_grace_period }

  # Eligible hubs
  let!(:eligible_free_hub) do
    trial_end = Time.current - grace_period - 1.day
    create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
  end

  let!(:eligible_free_unrestricted_hub) do
    trial_end = Time.current - grace_period - 1.day
    create(:hub, plan: :free_unrestricted, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
  end

  # Ineligible hubs
  let!(:active_trial_hub) do
    create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now)
  end

  let!(:within_grace_period_hub) do
    trial_end = 15.days.ago
    create(:hub, plan: :free, trial_started_at: trial_end - 30.days, trial_ends_at: trial_end)
  end

  let!(:enterprise_hub) do
    create(:hub, plan: :enterprise)
  end

  it "enqueues deletion workers only for eligible hubs" do
    expect(HubDeletionWorker).to receive(:perform_async).with(eligible_free_hub.id)
    expect(HubDeletionWorker).to receive(:perform_async).with(eligible_free_unrestricted_hub.id)
    expect(HubDeletionWorker).not_to receive(:perform_async).with(active_trial_hub.id)
    expect(HubDeletionWorker).not_to receive(:perform_async).with(within_grace_period_hub.id)
    expect(HubDeletionWorker).not_to receive(:perform_async).with(enterprise_hub.id)

    described_class.new.perform
  end

  it "does not enqueue for ineligible hubs" do
    # Create only ineligible hubs
    Hub.destroy_all
    create(:hub, plan: :free, trial_started_at: 10.days.ago, trial_ends_at: 20.days.from_now)
    create(:hub, plan: :enterprise)

    expect(HubDeletionWorker).not_to receive(:perform_async)

    described_class.new.perform
  end

  it "does not enqueue for premium hubs" do
    # Create only premium hubs
    Hub.destroy_all
    premium1 = create(:hub, plan: :enterprise)
    premium2 = create(:hub, plan: :enterprise)

    expect(HubDeletionWorker).not_to receive(:perform_async).with(premium1.id)
    expect(HubDeletionWorker).not_to receive(:perform_async).with(premium2.id)

    described_class.new.perform
  end

  it "runs successfully" do
    allow(HubDeletionWorker).to receive(:perform_async)
    expect { described_class.new.perform }.not_to raise_error
  end
end
