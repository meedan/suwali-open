class AddSummaryUpdatedAtToNotebooks < ActiveRecord::Migration[7.1]
  def change
    add_column :notebooks, :summary_updated_at, :datetime
  end
end
