class Api::WebhooksController < ApplicationController
  before_action :set_current_external_user_id
  around_action :set_audit_user

  def telegram
    webhook_service = WebhookServices::TelegramService.new(webhook_params)

    if webhook_service.valid?
      webhook_service.process(request.headers["X-Telegram-Bot-Api-Secret-Token"])
      head :ok
    else
      head :bad_request
    end
  end

  def whatsapp
    webhook_service = WebhookServices::WhatsappService.new(ENV["WHATSAPP_APP_SECRET"], ENV["WHATSAPP_VERIFY_TOKEN"])

    if request.get? || request.head?
      status, body, content_type = webhook_service.handle_verification(webhook_params)
      return render plain: body, status:, content_type:
    end

    if webhook_service.valid?(request)
      webhook_service.process(request)
      head :ok
    else
      head :bad_request
    end
  rescue => e
    LogService.log(:error, "WhatsappWebhook", "Unhandled webhook request: #{request.raw_post} (headers: #{request.headers.select { |k, _| k.start_with?("HTTP_") }}) (error: #{e.message})")
    head :ok
  end

  def sms
    webhook_service = WebhookServices::SmsService.new(params[:messaging_integration_id])

    if webhook_service.valid?(request)
      webhook_service.process(request)
      head :ok
    else
      head :bad_request
    end
  rescue => e
    LogService.log(:error, "SmsWebhook", "Unhandled webhook request (error: #{e.message})")
    head :ok
  end

  private

  def webhook_params
    # Webhook payloads have complex, deeply-nested structures defined by external services
    # (Telegram, WhatsApp). Explicit permit is not practical here; the service layer
    # (WebhookServices::TelegramService / WhatsappService) is responsible for validating
    # the payload structure before acting on it. These params are never passed directly to
    # model mass-assignment.
    # nosemgrep: ruby.lang.security.model-attr-accessible.model-attr-accessible -- webhook payload passed to service objects only, never used for mass assignment
    params.permit!.to_h
  end

  def set_current_external_user_id
    sender = webhook_params.dig("message", "from", "id") || # Telegram
      webhook_params.dig("entry", 0, "changes", 0, "value", "contacts", 0, "wa_id") || # WhatsApp phone
      webhook_params.dig("entry", 0, "changes", 0, "value", "contacts", 0, "user_id") || # WhatsApp BSUID (fallback)
      webhook_params["From"]&.sub(/\Arcs:/, "") # SMS/RCS sender

    # audit.*_log.log_user_id is a bigint, and the audit trigger casts this session variable to it.
    # Identifiers that don't cast (WhatsApp identity ids like "MA.1096…" for users who don't share
    # their phone number, RCS agent ids) abort the trigger and roll back the whole webhook.
    @current_external_user_id = sender if sender.to_s.match?(/\A\+?\d+\z/)
  end

  attr_reader :current_external_user_id

  def set_audit_user
    if current_external_user_id
      ActiveRecord::Base.transaction do
        ActiveRecord::Base.connection.execute(
          ActiveRecord::Base.sanitize_sql(["SET LOCAL audit.current_user_id = ?", current_external_user_id.to_s])
        )
        yield
      end
    else
      yield
    end
  end
end
