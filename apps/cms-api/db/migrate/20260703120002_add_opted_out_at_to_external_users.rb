class AddOptedOutAtToExternalUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :external_users, :opted_out_at, :datetime
  end
end
