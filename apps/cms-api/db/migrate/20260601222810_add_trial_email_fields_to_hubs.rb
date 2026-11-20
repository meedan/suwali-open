class AddTrialEmailFieldsToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :trial_emails_enabled, :boolean, default: true, null: false
    add_column :hubs, :trial_emails_sent, :jsonb, default: [], null: false
  end
end
