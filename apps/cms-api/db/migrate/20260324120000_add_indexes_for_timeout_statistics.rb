class AddIndexesForTimeoutStatistics < ActiveRecord::Migration[7.1]
  def change
    # Primary index for timeout window queries - supports filtering by state,
    # joining to conversations, and ordering by created_at
    add_index :messages, [:state, :conversation_id, :created_at],
      name: "index_messages_on_state_conversation_created"

    # Index for finding window start times - supports efficient MIN(created_at)
    # queries filtered by conversation_id and created_at range
    add_index :messages, [:conversation_id, :created_at],
      name: "index_messages_on_conversation_created"

    # Composite index for hub filtering with platform exclusion
    add_index :conversations, [:hub_id, :platform],
      name: "index_conversations_on_hub_platform"
  end
end
