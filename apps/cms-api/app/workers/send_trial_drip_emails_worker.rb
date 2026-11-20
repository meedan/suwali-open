class SendTrialDripEmailsWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 0

  # Maps email names to [days_before_end, mailer_method]
  # Order matters: later milestones first so we don't send stale emails
  MILESTONES = [
    ["trial_ends_tomorrow", 1],
    ["trial_three_days_left", 3],
    ["trial_one_week_left", 7],
    ["trial_halfway", :halfway]
  ].freeze

  def perform
    Hub.where(plan: [Hub.plans[:free], Hub.plans[:free_unrestricted]])
      .where(trial_emails_enabled: true)
      .where.not(trial_started_at: nil)
      .where.not(trial_ends_at: nil)
      .where("trial_ends_at > ?", Time.current)
      .find_each do |hub|
        send_due_emails(hub)
      end
  end

  private

  def send_due_emails(hub)
    MILESTONES.each do |email_name, threshold|
      next if hub.trial_emails_sent.include?(email_name)
      next unless milestone_reached?(hub, threshold)

      hub.send_trial_emails(email_name)
      hub.reload
    end
  end

  def milestone_reached?(hub, threshold)
    if threshold == :halfway
      halfway_date = hub.trial_started_at + ((hub.trial_ends_at - hub.trial_started_at) / 2)
      Time.current >= halfway_date
    else
      days_remaining = (hub.trial_ends_at.to_date - Date.current).to_i
      days_remaining <= threshold
    end
  end
end
