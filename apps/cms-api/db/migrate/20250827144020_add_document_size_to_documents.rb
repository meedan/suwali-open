class AddDocumentSizeToDocuments < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :document_size, :integer
  end
end
