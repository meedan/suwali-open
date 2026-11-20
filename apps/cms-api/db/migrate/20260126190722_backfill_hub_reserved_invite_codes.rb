class BackfillHubReservedInviteCodes < ActiveRecord::Migration[7.1]
  def up
    # Reserve all existing hub invite codes to prevent reuse
    # Use raw SQL to avoid model callbacks and validations
    execute <<-SQL
      INSERT INTO hub_reserved_invite_codes (code, created_at, updated_at)
      SELECT DISTINCT invite_code, NOW(), NOW()
      FROM hubs
      WHERE invite_code IS NOT NULL
      ON CONFLICT (code) DO NOTHING
    SQL
  end

  def down
    # Remove reserved codes that match current hubs
    execute <<-SQL
      DELETE FROM hub_reserved_invite_codes
      WHERE code IN (SELECT invite_code FROM hubs WHERE invite_code IS NOT NULL)
    SQL
  end
end
