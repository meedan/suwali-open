class CreateExternalResources < ActiveRecord::Migration[7.1]
  def change
    create_table :external_resources do |t|
      t.references :hub, null: false, foreign_key: true
      t.string :title
      t.text :description
      t.text :scenarios, array: true, default: []

      t.timestamps
    end
  end
end
