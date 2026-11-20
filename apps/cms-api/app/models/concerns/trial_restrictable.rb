module TrialRestrictable
  extend ActiveSupport::Concern

  included do
    validate :check_trial_expiration, on: :create
  end

  private

  def check_trial_expiration
    return unless hub.present?
    return unless hub.blocks_creation_due_to_expired_trial?
    errors.add(:base, hub.trial_expiration_error)
  end
end
