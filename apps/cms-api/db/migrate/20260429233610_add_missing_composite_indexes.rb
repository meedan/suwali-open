class AddMissingCompositeIndexes < ActiveRecord::Migration[7.1]
  def change
    # High priority: nearly every conversation query filters by hub + soft-delete
    add_index :conversations, [:hub_id, :deleted_at],
      name: "index_conversations_on_hub_id_and_deleted_at"

    # Polymorphic participant lookups scoped by hub
    add_index :conversations, [:participant_type, :participant_id, :hub_id],
      name: "index_conversations_on_participant_and_hub_id"

    # Membership approval filtering (checked on every authenticated request)
    add_index :hub_memberships, [:hub_id, :approved],
      name: "index_hub_memberships_on_hub_id_and_approved"

    # Admin/editor role queries within a hub
    add_index :hub_memberships, [:hub_id, :role, :approved],
      name: "index_hub_memberships_on_hub_id_role_approved"

    # User's approved hubs lookup
    add_index :hub_memberships, [:user_id, :approved],
      name: "index_hub_memberships_on_user_id_and_approved"

    # Sources: not_deleted scope with hub filter
    add_index :sources, [:hub_id, :deleted_at],
      name: "index_sources_on_hub_id_and_deleted_at"

    # ExternalUser: active scope filtered by hub
    add_index :external_users, [:hub_id, :last_message_at],
      name: "index_external_users_on_hub_id_and_last_message_at"

    # Message cluster centroid reassignment + ordering
    add_index :messages, [:message_cluster_id, :created_at],
      name: "index_messages_on_cluster_id_and_created_at"

    # State-filtered message history within a conversation
    add_index :messages, [:conversation_id, :state, :created_at],
      name: "index_messages_on_conversation_state_created"

    # Documents: soft-delete filtering within a source
    add_index :documents, [:source_id, :active],
      name: "index_documents_on_source_id_and_active"

    # Notebooks: user's notebooks within a hub
    add_index :notebooks, [:hub_id, :user_id],
      name: "index_notebooks_on_hub_id_and_user_id"

    # Remove duplicate index on conversations (identical to index_conversations_on_participant)
    remove_index :conversations, name: "index_conversations_on_participant_type_and_participant_id"
  end
end
