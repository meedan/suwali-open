class CreateHubs < ActiveRecord::Migration[7.1]
  def change
    create_table :hubs do |t|
      t.string :name
      t.string :invite_code, null: false
      t.references :organization, null: false, foreign_key: true

      t.timestamps
      t.index :invite_code, unique: true
    end
  end
end
