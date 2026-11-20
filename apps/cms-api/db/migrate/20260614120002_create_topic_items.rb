class CreateTopicItems < ActiveRecord::Migration[7.1]
  def up
    create_table :topic_items do |t|
      t.references :topic, null: false, foreign_key: true
      t.references :item, polymorphic: true, null: false

      t.timestamps
    end

    add_index :topic_items, [:topic_id, :item_type, :item_id], unique: true, name: "idx_unique_topic_item"

    execute "SELECT audit.add_audit_trigger('public', 'topic_items');"
  end

  def down
    drop_table :topic_items
  end
end
