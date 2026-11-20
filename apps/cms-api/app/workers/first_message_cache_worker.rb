class FirstMessageCacheWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  def perform(hub_id)
    hub = Hub.find_by(id: hub_id)
    return unless hub

    hub.generate_and_cache_first_message(hub.default_language || "en")
  rescue KnowledgeService::Error => e
    LogService.log(:error, "FirstMessageCacheWorker", "Failed to regenerate first message cache for hub #{hub_id}: #{e.message}")
    raise e
  end
end
