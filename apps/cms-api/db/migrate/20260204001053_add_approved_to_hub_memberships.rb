class AddApprovedToHubMemberships < ActiveRecord::Migration[7.1]
  def change
    add_column :hub_memberships, :approved, :boolean, default: true, null: false
  end
end
