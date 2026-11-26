class AddPublicUrlToDocuments < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :public_url, :text
  end
end
