class CreateTopics < ActiveRecord::Migration[7.1]
  def up
    create_table :topics do |t|
      t.references :hub, null: false, foreign_key: true
      t.string :name, null: false

      t.timestamps
    end

    add_index :topics, [:hub_id, :name], unique: true

    execute "SELECT audit.add_audit_trigger('public', 'topics');"
  end

  def down
    drop_table :topics
  end
end
