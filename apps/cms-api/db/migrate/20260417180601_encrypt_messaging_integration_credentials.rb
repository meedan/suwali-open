class EncryptMessagingIntegrationCredentials < ActiveRecord::Migration[7.1]
  def up
    # Allow reading existing plaintext credentials before re-saving them encrypted.
    # This setting is also enabled in application.rb for the transition period.
    ActiveRecord::Encryption.config.support_unencrypted_data = true

    MessagingIntegration.find_each do |integration|
      next if integration.credentials.blank?
      integration.save!
    rescue => e
      say "Failed to encrypt MessagingIntegration id=#{integration.id}: #{e.message}"
      raise
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration
  end
end
