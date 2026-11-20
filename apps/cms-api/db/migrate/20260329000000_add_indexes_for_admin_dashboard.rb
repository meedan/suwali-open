class AddIndexesForAdminDashboard < ActiveRecord::Migration[7.1]
  def change
    add_index :external_users, :last_message_at
    add_index :documents, [:source_id, :sync_status]
    add_index :conversations, :updated_at
  end
end
