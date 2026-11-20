class AddMessagesCountToConversations < ActiveRecord::Migration[7.1]
  def change
    add_column :conversations, :messages_count, :integer, default: 0, null: false

    # Backfill existing conversations with their message counts
    reversible do |dir|
      dir.up do
        execute <<-SQL
          UPDATE conversations
          SET messages_count = (
            SELECT COUNT(*)
            FROM messages
            WHERE messages.conversation_id = conversations.id
          )
        SQL
      end
    end
  end
end
