class CreateMessageClusters < ActiveRecord::Migration[7.1]
  def up
    create_table :message_clusters, id: :bigserial do |t|
      t.bigint :hub_id, null: false
      t.vector :centroid_embedding, limit: 768, null: false
      t.text :original_text, null: false
      t.integer :question_count, null: false, default: 1

      t.timestamps
    end

    add_foreign_key :message_clusters,
      :hubs,
      column: :hub_id,
      on_delete: :cascade,
      name: :fk_message_clusters_hub

    add_index :message_clusters, :hub_id
    add_index :message_clusters,
      :centroid_embedding,
      using: :hnsw,
      opclass: :vector_cosine_ops,
      name: :index_message_clusters_on_centroid_embedding
  end

  def down
    remove_index :message_clusters, name: :index_message_clusters_on_centroid_embedding
    remove_index :message_clusters, :hub_id
    remove_foreign_key :message_clusters, name: :fk_message_clusters_hub

    drop_table :message_clusters
  end
end
