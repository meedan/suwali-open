class AddUserWhoLastUpdatedSummaryToNotebooks < ActiveRecord::Migration[7.1]
  def change
    add_reference :notebooks, :last_summary_updated_by, foreign_key: {to_table: :users}, index: true, null: true
  end
end
