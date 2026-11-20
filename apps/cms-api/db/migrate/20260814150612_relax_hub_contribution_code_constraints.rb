class RelaxHubContributionCodeConstraints < ActiveRecord::Migration[7.1]
  def up
    # Codes are only matched against the hub the message belongs to, so two hubs can share one
    remove_index :hubs, :contribution_code
    add_index :hubs, :contribution_code

    Hub.reset_column_information
    Hub.where(contribution_code: nil).find_each do |hub|
      hub.update_column(:contribution_code, Hub.generate_contribution_code)
    end
  end

  def down
    remove_index :hubs, :contribution_code
    add_index :hubs, :contribution_code, unique: true
  end
end
