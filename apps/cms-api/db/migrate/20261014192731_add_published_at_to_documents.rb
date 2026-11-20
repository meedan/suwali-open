class AddPublishedAtToDocuments < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :published_at, :datetime
  end
end
