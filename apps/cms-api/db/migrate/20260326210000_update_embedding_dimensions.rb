class UpdateEmbeddingDimensions < ActiveRecord::Migration[7.1]
  def change
    reversible do |dir|
      dir.up do
        # Drop existing indexes
        execute "DROP INDEX IF EXISTS index_messages_on_embedding"
        execute "DROP INDEX IF EXISTS index_message_clusters_on_centroid_embedding"

        # Drop existing columns
        execute "ALTER TABLE messages DROP COLUMN IF EXISTS embedding"
        execute "ALTER TABLE message_clusters DROP COLUMN IF EXISTS centroid_embedding"

        # Recreate columns with new dimensions (1024)
        execute "ALTER TABLE messages ADD COLUMN embedding vector(1024)"
        execute "ALTER TABLE message_clusters ADD COLUMN centroid_embedding vector(1024)"

        # Recreate HNSW indexes
        execute <<~SQL
          CREATE INDEX index_messages_on_embedding
          ON messages
          USING hnsw (embedding vector_cosine_ops)
        SQL

        execute <<~SQL
          CREATE INDEX index_message_clusters_on_centroid_embedding
          ON message_clusters
          USING hnsw (centroid_embedding vector_cosine_ops)
        SQL
      end

      dir.down do
        # Drop indexes
        execute "DROP INDEX IF EXISTS index_messages_on_embedding"
        execute "DROP INDEX IF EXISTS index_message_clusters_on_centroid_embedding"

        # Drop columns
        execute "ALTER TABLE messages DROP COLUMN IF EXISTS embedding"
        execute "ALTER TABLE message_clusters DROP COLUMN IF EXISTS centroid_embedding"

        # Recreate with old dimensions (768)
        execute "ALTER TABLE messages ADD COLUMN embedding vector(768)"
        execute "ALTER TABLE message_clusters ADD COLUMN centroid_embedding vector(768) NOT NULL"

        # Recreate indexes
        execute <<~SQL
          CREATE INDEX index_messages_on_embedding
          ON messages
          USING hnsw (embedding vector_cosine_ops)
        SQL

        execute <<~SQL
          CREATE INDEX index_message_clusters_on_centroid_embedding
          ON message_clusters
          USING hnsw (centroid_embedding vector_cosine_ops)
        SQL
      end
    end
  end
end
