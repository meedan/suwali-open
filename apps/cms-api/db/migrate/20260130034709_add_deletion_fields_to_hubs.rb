class AddDeletionFieldsToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :deletion_in_progress, :boolean, default: false, null: false
    add_column :hubs, :deletion_started_at, :datetime
  end
end
