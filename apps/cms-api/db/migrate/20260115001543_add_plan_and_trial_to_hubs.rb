class AddPlanAndTrialToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :plan, :integer, default: 0, null: false
    add_column :hubs, :trial_started_at, :datetime
    add_column :hubs, :trial_ends_at, :datetime
    Hub.reset_column_information
    Hub.update_all(plan: :enterprise)
  end
end
