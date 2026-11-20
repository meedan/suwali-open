class AddContributionWorkflowModeToHubs < ActiveRecord::Migration[7.1]
  def change
    add_column :hubs, :contribution_workflow_mode, :string, default: "direct", null: false
  end
end
