class AddActiveToDocuments < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :active, :boolean, default: true, null: false
  end
end
