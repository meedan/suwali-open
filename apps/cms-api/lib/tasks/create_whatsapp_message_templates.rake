namespace :whatsapp do
  # RAILS_ENV=production bundle exec rake whatsapp:create_message_templates
  desc "Enqueue message template creation for all connected WhatsApp integrations"
  task create_message_templates: :environment do
    enqueued = 0
    skipped = 0

    WhatsappMessagingIntegration.find_each do |integration|
      if integration.get_credential(:waba_id).blank? || integration.get_credential(:business_token).blank?
        skipped += 1
        next
      end

      WhatsappTemplateCreationWorker.perform_async(integration.id)
      enqueued += 1
    end

    puts "[#{Time.now}] Enqueued template creation for #{enqueued} WhatsApp integrations (#{skipped} skipped without credentials)"
  end
end
