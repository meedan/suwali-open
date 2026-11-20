class AddEmbeddingToMessages < ActiveRecord::Migration[7.1]
  def change
    # Use reversible block for raw SQL
    reversible do |dir|
      dir.up do
        # Add vector column with explicit dimensions
        execute "ALTER TABLE messages ADD COLUMN embedding vector(768)"

        # Create HNSW index
        execute <<~SQL
          CREATE INDEX index_messages_on_embedding
          ON messages
          USING hnsw (embedding vector_cosine_ops)
        SQL
      end

      dir.down do
        execute "DROP INDEX IF EXISTS index_messages_on_embedding"
        execute "ALTER TABLE messages DROP COLUMN embedding"
      end
    end
  end
end
