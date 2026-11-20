class ConvertMessagingIntegrationToSti < ActiveRecord::Migration[7.1]
  def up
    add_column :messaging_integrations, :type, :string
    add_index :messaging_integrations, :type

    # Migrate existing records
    MessagingIntegration.reset_column_information
    MessagingIntegration.where(platform: nil).update_all(type: "InternalMessagingIntegration")
    MessagingIntegration.where(platform: 0).update_all(type: "InternalMessagingIntegration")
    MessagingIntegration.where(platform: 1).update_all(type: "TelegramMessagingIntegration")
    MessagingIntegration.where(platform: 2).update_all(type: "WhatsappMessagingIntegration")

    # Make type non-nullable after data migration
    change_column_null :messaging_integrations, :type, false
    remove_column :messaging_integrations, :platform
  end

  def down
    remove_index :messaging_integrations, :type
    remove_column :messaging_integrations, :type
  end
end
