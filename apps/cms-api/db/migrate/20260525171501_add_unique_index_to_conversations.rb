class AddUniqueIndexToConversations < ActiveRecord::Migration[7.1]
  def change
    add_index :conversations, [:hub_id, :participant_type, :participant_id, :platform],
      unique: true,
      where: "deleted_at IS NULL AND participant_type = 'ExternalUser'",
      name: "index_conversations_uniqueness_per_participant"
  end
end
