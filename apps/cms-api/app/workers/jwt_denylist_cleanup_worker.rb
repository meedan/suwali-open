class JwtDenylistCleanupWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  def perform
    deleted_count = JwtDenylist.where("exp < ?", Time.current).delete_all
    LogService.log(:info, "JwtDenylistCleanupWorker", "Cleaned up #{deleted_count} expired JWT denylist entries")
  end
end
