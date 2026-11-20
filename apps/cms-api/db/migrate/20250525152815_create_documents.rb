class CreateDocuments < ActiveRecord::Migration[7.1]
  def change
    create_table :documents do |t|
      t.references :source, null: false, foreign_key: true
      t.string :title, null: false
      t.string :external_id, null: false
      t.text :content
      t.jsonb :metadata
      t.integer :document_type, null: false

      t.timestamps
      t.index [:source_id, :external_id], unique: true
    end
  end
end
