class AddDeletionRequestedToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :deletion_requested_at, :datetime
    add_column :hubs, :deletion_requested_by_email, :string
  end
end
