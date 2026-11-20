class StaleSyncWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 0

  def perform(class_name, id)
    return unless KnowledgeServiceSyncable::SYNCABLE_CLASSES.include?(class_name)

    # nosemgrep: ruby.rails.security.brakeman.check-unsafe-reflection.check-unsafe-reflection -- class_name is checked against a literal allowlist above
    record = class_name.constantize.find_by(id: id)
    return unless record
    return unless record.pending?

    record.update_column(:sync_status, :error)
    LogService.log(:info, "StaleSyncWorker", "Updated item sync status from `pending` to `error`. Item id: #{record.id}, item class: #{class_name}")
    record.try(:retry_item_summary_generation)
  end
end
