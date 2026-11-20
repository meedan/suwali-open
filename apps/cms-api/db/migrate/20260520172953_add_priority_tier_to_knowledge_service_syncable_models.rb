class AddPriorityTierToKnowledgeServiceSyncableModels < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :priority_tier, :integer, default: 1, null: false
    add_column :notebooks, :priority_tier, :integer, default: 1, null: false
    # Default 2 (high), since contributions were always ingested with PRIORITY_TIER_HIGH.
    # See KnowledgeServiceWorker#ingest_community_knowledge.
    add_column :contributions, :priority_tier, :integer, default: 2, null: false
  end
end
