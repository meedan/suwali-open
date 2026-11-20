class AddSummaryToDocuments < ActiveRecord::Migration[7.1]
  def change
    add_column :documents, :summary, :text
  end
end
