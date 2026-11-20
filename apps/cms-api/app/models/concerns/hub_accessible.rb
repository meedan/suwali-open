module HubAccessible
  extend ActiveSupport::Concern

  included do
    scope :accessible_by, ->(user) {
      if user.is_admin
        all
      else
        where(hub_id: user.hub_memberships.approved.select(:hub_id))
      end
    }
  end
end
