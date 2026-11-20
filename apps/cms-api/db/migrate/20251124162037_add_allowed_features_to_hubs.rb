class AddAllowedFeaturesToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :allowed_features, :jsonb, default: {}, null: false
  end
end
