class SoftDeleteWorker
  include Sidekiq::Worker
  sidekiq_options queue: :delete, retry: 3

  sidekiq_retry_in { |_count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted { |msg, _exception| LogService.log(:error, msg["class"], "Failed to process job #{msg["args"].first} after #{msg["retry_count"]} retries") }

  # Subclasses must implement:
  #   def parent_class          => e.g. Source
  #   def children_association  => e.g. :documents

  def perform(parent_id)
    parent = parent_class.find_by(id: parent_id)
    worker_name = self.class.name
    parent_name = parent_class.name.downcase

    unless parent
      LogService.log(:info, worker_name, "#{parent_class} #{parent_id} not found, may have already been deleted")
      return
    end

    unless parent.deleted?
      LogService.log(:info, worker_name, "#{parent_class} #{parent_id} is not marked as deleted, skipping")
      return
    end

    child_count = parent.public_send(children_association).count
    LogService.log(:info, worker_name, "Starting deletion of #{parent_name} #{parent_id} with #{child_count} #{children_association}")

    parent.public_send(children_association).find_each(&:destroy!)

    parent_class.transaction do
      parent_class.where(id: parent.id).update_all(deleted_at: nil)
      parent.reload
      parent.destroy!
    end

    LogService.log(:info, worker_name, "Successfully deleted #{parent_name} #{parent_id}")
  end
end
