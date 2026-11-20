class AddCustomLimitsToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :custom_limits, :jsonb
  end
end
