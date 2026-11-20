class AddAiSummaryToMessageCluster < ActiveRecord::Migration[7.1]
  def change
    add_column :message_clusters, :ai_summary, :text
  end
end
