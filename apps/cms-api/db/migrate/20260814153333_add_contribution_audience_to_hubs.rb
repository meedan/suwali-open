class AddContributionAudienceToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :contribution_audience, :string, default: "trusted_end_users", null: false
  end
end
