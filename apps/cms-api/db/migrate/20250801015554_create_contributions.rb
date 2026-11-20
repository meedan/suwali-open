class CreateContributions < ActiveRecord::Migration[7.1]
  def change
    create_table :contributions do |t|
      t.text :content
      t.references :message, null: false, foreign_key: true
      t.references :hub, null: false, foreign_key: true

      t.timestamps
    end
  end
end
