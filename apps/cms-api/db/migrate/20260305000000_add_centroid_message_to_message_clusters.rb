class AddCentroidMessageToMessageClusters < ActiveRecord::Migration[7.1]
  def change
    add_reference :message_clusters, :centroid_message, foreign_key: {to_table: :messages}, null: true
  end
end
