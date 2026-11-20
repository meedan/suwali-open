class AddSettingsToMessagingIntegrations < ActiveRecord::Migration[7.1]
  def change
    add_column :messaging_integrations, :settings, :jsonb, null: false, default: {}
  end
end
