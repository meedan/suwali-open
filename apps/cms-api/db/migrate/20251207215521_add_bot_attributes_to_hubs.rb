class AddBotAttributesToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :bot_attributes, :jsonb
  end
end
