class AddOnePendingPerHubIndexToBulkConversationExports < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    # 0 is BulkConversationExport.statuses[:pending]
    add_index :bulk_conversation_exports, :hub_id, unique: true, where: "status = 0",
      name: "index_bulk_conversation_exports_one_pending_per_hub", algorithm: :concurrently
  end
end
