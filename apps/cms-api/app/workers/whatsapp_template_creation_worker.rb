class WhatsappTemplateCreationWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  sidekiq_retries_exhausted { |msg, _exception| LogService.log(:error, "WhatsappTemplateCreationWorker", "Retries exhausted after 3 attempts - Integration ID: #{msg["args"][0]}, Job ID: #{msg["jid"]}") }

  def perform(integration_id)
    integration = WhatsappMessagingIntegration.find_by(id: integration_id)
    return if integration.nil?

    waba_id = integration.get_credential(:waba_id)
    business_token = integration.get_credential(:business_token)
    if waba_id.blank? || business_token.blank?
      LogService.log(:error, "WhatsappTemplateCreationWorker", "Missing waba_id or business_token for integration #{integration_id}; skipping template creation")
      return
    end

    service = WhatsappService.new(LogService)

    # Idempotency: skip templates that already exist (e.g., job retries, backfill re-runs)
    existing_templates = service.fetch_message_templates(waba_id, business_token)

    SUPPORTED_LANGUAGES.keys.each do |language|
      code = WhatsappMessagingIntegration.template_language_code(language)
      Hub::TONES.each do |tone|
        name = WhatsappMessagingIntegration.topic_notification_template_name(tone)
        next if existing_templates.any? { |template| template["name"] == name && template["language"] == code }

        begin
          service.create_message_template(waba_id, business_token, name, code, "UTILITY", template_components(language, tone))
        rescue WhatsappService::Error => e
          raise unless e.template_category_mismatch?

          LogService.log(:warn, "WhatsappTemplateCreationWorker", "Template category mismatch (requested UTILITY) - Integration ID: #{integration_id}, Template: #{name}/#{code}")
        end
      end
    end
  end

  private

  def template_components(language, tone)
    I18n.with_locale(language) do
      [
        {
          type: "BODY",
          # The copy is shared with other platforms, so here we interpolate the
          # WhatsApp template placeholders instead of actual values
          text: I18n.t(:"topic_notification_body_#{tone}", topic: "{{1}}", content: "{{2}}"),
          example: {
            body_text: [[
              I18n.t(:topic_notification_example_topic),
              I18n.t(:topic_notification_example_content)
            ]]
          }
        },
        {
          type: "BUTTONS",
          buttons: [
            {type: "QUICK_REPLY", text: I18n.t(:topic_notification_see_more_button)},
            {type: "QUICK_REPLY", text: I18n.t(:topic_notification_unsubscribe_button)}
          ]
        }
      ]
    end
  end
end
