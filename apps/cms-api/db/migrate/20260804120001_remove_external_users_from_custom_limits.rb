class RemoveExternalUsersFromCustomLimits < ActiveRecord::Migration[7.1]
  def up
    execute <<~SQL
      UPDATE hubs
      SET custom_limits = custom_limits - 'external_users'
      WHERE custom_limits ? 'external_users'
    SQL
  end

  def down
    # The removed external_users values cannot be restored.
  end
end
