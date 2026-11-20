class CreateDeletedDocuments < ActiveRecord::Migration[7.1]
  def change
    create_table :deleted_documents do |t|
      t.string :external_id, null: false
      t.references :source, null: false, foreign_key: true

      t.timestamps
    end
    add_index :deleted_documents, [:external_id, :source_id], unique: true
  end
end
