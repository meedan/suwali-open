class CreateConversations < ActiveRecord::Migration[7.1]
  def change
    create_table :conversations do |t|
      t.string :title, null: false
      t.integer :platform, null: false
      t.references :hub, null: false
      t.references :participant, polymorphic: true, null: false

      t.timestamps
    end
    add_index :conversations, [:participant_type, :participant_id]
  end
end
