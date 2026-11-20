class AddIngestionStartedAtToSources < ActiveRecord::Migration[7.1]
  def change
    add_column :sources, :ingestion_started_at, :datetime
  end
end
