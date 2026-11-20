class AddPublishedAtToNotebooks < ActiveRecord::Migration[7.1]
  def change
    add_column :notebooks, :published_at, :datetime
  end
end
