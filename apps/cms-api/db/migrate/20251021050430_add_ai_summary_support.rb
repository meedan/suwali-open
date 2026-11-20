class AddAiSummarySupport < ActiveRecord::Migration[7.1]
  def change
    add_column :messages, :ai_summary, :text
    add_column :conversations, :ai_summary, :text
    add_column :documents, :ai_summary, :text
    add_column :contributions, :ai_summary, :text
    add_column :notes, :ai_summary, :text

    add_column :notebooks, :ai_summary, :text
    add_column :notebooks, :ai_summary_update_requested_at, :datetime
    add_column :notebooks, :ai_summary_updated_at, :datetime
  end
end
