class HubDeletionWorker
  include Sidekiq::Worker
  sidekiq_options queue: :delete, retry: 3

  sidekiq_retry_in { |count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted { |msg, _exception| LogService.log(:error, "HubDeletionWorker", "Failed to delete hub #{msg["args"].first} after #{msg["retry_count"]} retries") }

  def perform(hub_id)
    result = Hub.with_deletion_lock(hub_id) do |hub|
      # Re-check eligibility inside the lock
      unless eligible_for_deletion?(hub)
        LogService.log(:info, "HubDeletionWorker", "Hub #{hub_id} is no longer eligible for deletion, skipping")
        next
      end

      # Log counts before deletion
      document_count = Document.joins(:source).where(sources: {hub_id: hub.id}).count
      LogService.log(:info, "HubDeletionWorker", "Starting deletion of hub #{hub_id} with #{document_count} documents")

      # Get user IDs before destroying the hub (so we can check for orphaned users after)
      user_ids = hub.users.pluck(:id)

      # Send trial deletion emails before destroying (not for admin-requested deletions)
      hub.send_trial_emails(:trial_hub_deleted) if hub.deletion_requested_at.nil?

      # Destroy the hub - Rails will cascade to all associations via dependent: :destroy
      # Sources will cascade to Documents, which will trigger KS cleanup callbacks
      hub.destroy!

      # Delete orphaned users (users who were members of only this hub)
      delete_orphaned_users(user_ids, hub_id)

      LogService.log(:info, "HubDeletionWorker", "Successfully deleted hub #{hub_id}")
    end

    case result
    when :not_found
      LogService.log(:info, "HubDeletionWorker", "Hub #{hub_id} not found, may have already been deleted")
    when :locked
      LogService.log(:info, "HubDeletionWorker", "Hub #{hub_id} deletion already in progress, skipping")
    end
  end

  private

  def eligible_for_deletion?(hub)
    # Must be a free plan (free or free_unrestricted)
    return false unless hub.free?

    # Flagged by a write super admin
    return true if hub.deletion_requested_at.present?

    # Must have trial_ends_at
    return false if hub.trial_ends_at.nil?

    # Must be past grace period
    grace_period_cutoff = Time.current - Hub.trial_deletion_grace_period
    hub.trial_ends_at < grace_period_cutoff
  end

  def delete_orphaned_users(user_ids, hub_id)
    orphaned_count = 0

    user_ids.each do |user_id|
      # Check if user has any remaining hub memberships
      unless HubMembership.exists?(user_id: user_id)
        user = User.find_by(id: user_id)
        if user
          user.destroy!
          orphaned_count += 1
        end
      end
    end

    if orphaned_count > 0
      LogService.log(:info, "HubDeletionWorker", "Deleted #{orphaned_count} orphaned user(s) from hub #{hub_id}")
    end
  end
end
