class AddStateToConversations < ActiveRecord::Migration[7.1]
  def change
    add_column :conversations, :state, :integer, default: 0, null: false
    add_index :conversations, :state
  end
end
