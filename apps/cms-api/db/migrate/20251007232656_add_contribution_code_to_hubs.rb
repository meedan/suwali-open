class AddContributionCodeToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :contribution_code, :string
    add_index :hubs, :contribution_code, unique: true
    Hub.reset_column_information
  end
end
