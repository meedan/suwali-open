class CreateNotebooks < ActiveRecord::Migration[7.1]
  def change
    create_table :notebooks do |t|
      t.references :hub, null: false, foreign_key: true
      t.string :name, null: false
      t.text :summary
      t.boolean :published, default: false
      t.references :user, null: false, foreign_key: true

      t.timestamps
    end
  end
end
