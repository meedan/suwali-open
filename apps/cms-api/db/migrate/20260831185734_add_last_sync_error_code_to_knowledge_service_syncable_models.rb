class AddLastSyncErrorCodeToKnowledgeServiceSyncableModels < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :last_sync_error_code, :string
    add_column :notebooks, :last_sync_error_code, :string
    add_column :contributions, :last_sync_error_code, :string
  end
end
