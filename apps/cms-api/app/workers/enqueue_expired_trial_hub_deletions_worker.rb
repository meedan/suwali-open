class EnqueueExpiredTrialHubDeletionsWorker
  include Sidekiq::Worker
  sidekiq_options queue: :delete, retry: 0

  def perform
    Hub.eligible_for_deletion.find_each do |hub|
      HubDeletionWorker.perform_async(hub.id)
    end
  end
end
