class CreateSources < ActiveRecord::Migration[7.1]
  def change
    create_table :sources do |t|
      t.references :hub, null: false, foreign_key: true
      t.string :name, null: false
      t.integer :source_type, null: false
      t.jsonb :config
      t.datetime :last_synced_at
      t.boolean :active, null: false, default: false

      t.timestamps
    end
  end
end
