class AddRoleToHubMemberships < ActiveRecord::Migration[7.1]
  def change
    add_column :hub_memberships, :role, :integer, default: 1, null: false
  end
end
