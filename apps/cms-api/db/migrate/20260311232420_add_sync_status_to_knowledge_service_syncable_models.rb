class AddSyncStatusToKnowledgeServiceSyncableModels < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :sync_status, :integer, default: 0, null: false
    add_column :notebooks, :sync_status, :integer, default: 0, null: false
    add_column :contributions, :sync_status, :integer, default: 0, null: false
    add_index :documents, :sync_status
    add_index :notebooks, :sync_status
    add_index :contributions, :sync_status
    Document.reset_column_information
    Notebook.reset_column_information
    Contribution.reset_column_information
    Document.update_all(sync_status: :complete)
    Notebook.update_all(sync_status: :complete)
    Contribution.update_all(sync_status: :complete)
  end
end
