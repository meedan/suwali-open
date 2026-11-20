module Api
  class MessagingIntegrationsController < AuthenticatedController
    def index
      @hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(@hub)

      render json: @hub.messaging_integrations
    end

    def create
      hub = Hub.find(params[:messaging_integration][:hub_id].to_i)
      return unless require_member!(hub)
      return unless require_admin!(hub)

      platform = create_params[:platform].to_s
      case platform
      when "telegram"
        @integration = TelegramMessagingIntegration.new(active: true)
        @integration.credentials = {"bot_token" => create_params[:telegram_bot_token].to_s.gsub(/\s*/, "")}
      when "whatsapp"
        @integration = WhatsappMessagingIntegration.new(active: false)
      when "sms"
        @integration = SmsMessagingIntegration.new(active: true)
        @integration.credentials = {"provider" => SmsProviders::DEFAULT_PROVIDER}
        @integration.provisioning_country = create_params[:sms_country]
        @integration.provisioning_number_type = create_params[:sms_number_type]
        @integration.provisioning_state = create_params[:sms_state]
        @integration.provisioning_area_code = create_params[:sms_area_code]
      when "signal"
        @integration = SignalMessagingIntegration.new(active: false)
      end
      @integration.hub_id = create_params[:hub_id].to_i

      if @integration.save
        render json: @integration, status: :created
      else
        render json: {errors: @integration.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      @integration = MessagingIntegration.find(params[:id].to_i)
      return unless require_member!(@integration.hub)
      return unless require_admin!(@integration.hub)

      @integration.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    def whatsapp_callback
      payload = params.permit(:integration_id, :state, :code, :waba_id, :phone_number_id, :business_id).to_h
      integration = WhatsappMessagingIntegration.find(payload[:integration_id])

      # Validations

      return unless require_member!(integration.hub)
      return unless require_admin!(integration.hub)

      if payload[:state].blank? || payload[:state] != integration.get_credential(:esu_state).to_s
        render json: {error: I18n.t(:error_whatsapp_invalid_state)}, status: :unprocessable_content and return
      end

      begin
        # Make API calls

        service = WhatsappService.new(LogService)
        business_token = service.exchange_code_for_business_token(payload[:code])
        service.subscribe_waba(payload[:waba_id], business_token)
        service.share_credit_line(payload[:waba_id], business_token)
        pin = SecureRandom.random_number(1_000_000).to_s.rjust(6, "0")
        phone_number = service.fetch_phone_number(payload[:phone_number_id], business_token)
        service.register_phone_number(payload[:phone_number_id], pin, business_token)

        # Persist credentials

        integration.set_credential(:business_token, business_token)
        integration.set_credential(:pin, pin)
        integration.set_credential(:waba_id, payload[:waba_id])
        integration.set_credential(:phone_number_id, payload[:phone_number_id])
        integration.set_credential(:phone_number, phone_number)
        integration.set_credential(:business_id, payload[:business_id])
        integration.active = true
        integration.save!
      rescue => e
        LogService.log(:error, "whatsapp_callback", "Couldn't complete WhatsApp Embedded Signup for integration #{integration.id}: #{e.message}")
      end

      render json: integration
    end

    private

    def create_params
      params.require(:messaging_integration).permit(:hub_id, :platform, :telegram_bot_token, :sms_country, :sms_number_type, :sms_state, :sms_area_code)
    end
  end
end
