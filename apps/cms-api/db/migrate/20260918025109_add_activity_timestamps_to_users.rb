class AddActivityTimestampsToUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :users, :last_login_at, :datetime
    add_column :users, :last_active_at, :datetime
  end
end
