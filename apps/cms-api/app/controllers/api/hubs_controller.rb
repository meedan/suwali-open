module Api
  class HubsController < AuthenticatedController
    skip_hub_authorization :create, :joinable
    before_action :set_hub, except: [:create, :joinable]
    # No DB writes; slow external call would hit Postgres' idle-in-transaction timeout.
    skip_around_action :set_audit_user, only: [:preview]

    def show
      render json: @hub.as_json(include_hub_membership_for_user_id: current_user.id, include_codes: current_user_can_access_hub?, include_pending_approvals_count: current_user_can_access_hub?, include_onboarding_tasks: current_user_can_access_hub?, include_monthly_messages_count: true), status: :ok
    end

    def joinable
      render json: current_user.joinable_hubs.map(&:as_joinable), status: :ok
    end

    def create
      organization = Organization.new(name: create_params[:name])
      @hub = Hub.new(name: create_params[:name], organization: organization, plan: :free, profile_picture: create_params[:profile_picture])

      begin
        ActiveRecord::Base.transaction do
          organization.save!
          @hub.save!
          HubMembership.create!(user: current_user, hub: @hub)
        end
        Sentry.capture_message("New hub created", level: :warning, extra: @hub.as_json) if defined?(Sentry)
        render json: @hub.as_json(include_codes: true, include_pending_approvals_count: true), status: :created
      rescue ActiveRecord::RecordInvalid => e
        errors = e.record ? e.record.errors.full_messages : [e.message]
        render json: {errors: errors}, status: :unprocessable_content
      end
    end

    def update
      return unless require_admin!(@hub)

      if @hub.update(update_hub_params)
        render json: @hub.as_json(include_codes: current_user_can_access_hub?), status: :ok
      else
        render json: {errors: @hub.errors.full_messages}, status: :unprocessable_content
      end
    end

    def refresh_invite_code
      return unless require_admin!(@hub)

      @hub.refresh_invite_code!
      render json: @hub.as_json(include_codes: current_user_can_access_hub?), status: :ok
    end

    def statistics
      fields = params[:fields]&.split(",") || []

      statistics = statistics_service

      if fields.empty?
        # Return all fields for backwards compatibility
        render json: statistics.dashboard, status: :ok
      else
        # Return only requested fields
        result = {range: statistics.range}
        fields.each do |field|
          result[field.to_sym] = statistics.public_send(field.to_sym) if statistics.respond_to?(field.to_sym)
        end
        render json: result, status: :ok
      end
    end

    def message_data_source_items_ranking
      collection, total_count = StatisticsService.new(@hub).message_data_source_items_ranking
      mdsi_ranking = paginate(collection, total_count)

      render json: {
        data: mdsi_ranking[:data].map(&:top_data_source_items_payload),
        pagination: mdsi_ranking[:pagination]
      }
    end

    def questions_ranking
      answered = params.key?(:answered) ? ActiveModel::Type::Boolean.new.cast(params[:answered]) : true
      collection, total_count = statistics_service.questions_ranking(answered)
      questions_ranking = paginate(collection, total_count)
      render json: {
        data: questions_ranking[:data].preload(:last_replied_external_message).map(&:questions_ranking_payload),
        pagination: questions_ranking[:pagination]
      }
    end

    def preview
      scenario = params[:scenario]
      unless ExternalResource::VALID_SCENARIOS.include?(scenario)
        render json: {error: I18n.t(:error_scenarios_invalid)}, status: :unprocessable_content
        return
      end

      language = params[:language].to_s if SUPPORTED_LANGUAGES.key?(params[:language].to_s) && @hub.supports_language?(params[:language].to_s)
      locale = language || @hub.default_language || I18n.locale
      answer = if scenario == "first_message"
        @hub.first_message_for_conversation(locale, force: true)
      elsif scenario == "conversation_closed"
        sample_topic_names = (1..3).map { |number| I18n.t(:preview_sample_topic, number: number, locale: locale) }
        @hub.closed_message_for_conversation(locale, sample_topic_names, force: true)
      else
        personalization = @hub.personalization_for_knowledge_service
        personalization[:default_language] = language if language
        KnowledgeService.preview(scenario, personalization)
      end

      render json: {answer: answer}, status: :ok
    rescue KnowledgeService::Error => e
      render json: {error: e.message}, status: :bad_request
    end

    private

    def statistics_service
      from = params[:from] ? Time.zone.parse(params[:from]).beginning_of_day : nil
      to = params[:to] ? Time.zone.parse(params[:to]).end_of_day : nil
      StatisticsService.new(@hub, from, to, group_by: params[:group_by], limit: params[:limit])
    end

    def current_user_can_access_hub?
      current_user.can_access_hub?(@hub)
    end

    def set_hub
      @hub = Hub.find(params[:id].to_i)
      require_member!(@hub)
    end

    def create_params
      params.require(:hub).permit(:name, :profile_picture)
    end

    def update_hub_params
      params.require(:hub).permit(:name, :profile_picture, :contribution_workflow_mode, :contribution_audience, :contribution_code, bot_attributes: [:name, :description, :tone, :default_language, supported_languages: []])
    end
  end
end
