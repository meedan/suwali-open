class CreateNotebookItems < ActiveRecord::Migration[7.1]
  def change
    create_table :notebook_items do |t|
      t.references :notebook, null: false, foreign_key: true
      t.references :item, polymorphic: true, null: false

      t.timestamps
    end
  end
end
