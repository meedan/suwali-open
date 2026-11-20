class AddFirstContributionTracking < ActiveRecord::Migration[7.1]
  def change
    add_column :contributions, :first_time_contributor, :boolean, default: false, null: false
    add_column :external_users, :first_contribution_at, :datetime
  end
end
