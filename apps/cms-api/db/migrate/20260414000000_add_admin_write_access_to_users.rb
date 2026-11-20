class AddAdminWriteAccessToUsers < ActiveRecord::Migration[7.1]
  def change
    add_column :users, :admin_write_access, :boolean, default: false, null: false
  end
end
