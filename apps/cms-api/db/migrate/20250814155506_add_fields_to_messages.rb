class AddFieldsToMessages < ActiveRecord::Migration[7.1]
  def change
    add_column :messages, :status, :integer, default: 0, null: false
    add_column :messages, :external_id, :string
    add_column :messages, :payload, :jsonb
    add_index :messages, [:external_id, :conversation_id, :direction], unique: true
  end
end
