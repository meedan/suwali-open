class SetExistingHubMembershipsToAdmin < ActiveRecord::Migration[7.1]
  def up
    HubMembership.reset_column_information
    # Set all existing hub memberships to admin role (0)
    HubMembership.update_all(role: 0)
  end

  def down
    # Data migration - no rollback needed
    # The schema migration will handle column removal if rolled back
  end
end
