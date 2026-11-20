class AddLastIngestionErrorsToSources < ActiveRecord::Migration[7.1]
  def change
    add_column :sources, :last_ingestion_errors, :jsonb, null: false, default: []
  end
end
