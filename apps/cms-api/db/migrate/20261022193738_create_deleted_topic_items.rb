class CreateDeletedTopicItems < ActiveRecord::Migration[7.1]
  def change
    create_table :deleted_topic_items do |t|
      t.references :topic, null: false, foreign_key: true, index: false
      t.references :item, polymorphic: true, null: false
      t.timestamps
    end
    add_index :deleted_topic_items, [:topic_id, :item_type, :item_id], unique: true, name: "idx_unique_deleted_topic_item"
  end
end
