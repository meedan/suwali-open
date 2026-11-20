class CreateMessagingIntegrations < ActiveRecord::Migration[7.1]
  def change
    create_table :messaging_integrations do |t|
      t.references :hub, null: false, foreign_key: true
      t.integer :platform
      t.jsonb :credentials
      t.boolean :active, default: false

      t.timestamps
    end
  end
end
