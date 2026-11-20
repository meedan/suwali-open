class CreateExternalUsers < ActiveRecord::Migration[7.1]
  def change
    create_table :external_users do |t|
      t.references :hub, null: false, foreign_key: true
      t.integer :platform, null: false
      t.string :external_id, null: false
      t.string :display_name
      t.jsonb :metadata
      t.boolean :trusted_user, default: false
      t.timestamp :first_message_at
      t.timestamp :last_message_at
      t.integer :messages_count, default: 0

      t.timestamps
    end
    add_index :external_users, [:hub_id, :external_id, :platform], unique: true
  end
end
