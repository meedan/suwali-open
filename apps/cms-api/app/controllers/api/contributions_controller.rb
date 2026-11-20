module Api
  class ContributionsController < AuthenticatedController
    include Filterable
    include KnowledgeServiceRetryable
    before_action :set_contribution, only: [:show, :update, :destroy]

    def show
      return unless require_member!(@contribution.hub)
      render json: @contribution.as_json, status: :ok
    end

    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      contributions = Contribution
        .where(hub_id: params[:hub_id].to_i)
        .includes(message: [:conversation, :topics])
        .preload(message: {conversation: {participant: :profile_picture_attachment}})
        .preload(topic_items: :topic)

      # The count before filtering, which the list's total is not once it is filtered
      unfiltered_count = contributions.count

      adjust_sort_by
      page = paginate(apply_filters(contributions))

      render json: page.merge(pagination: page[:pagination].merge(unfiltered_count: unfiltered_count))
    end

    def update
      return unless require_member!(@contribution.hub)
      if @contribution.update(update_params)
        render json: @contribution.as_json, status: :ok
      else
        render json: {errors: @contribution.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      return unless require_member!(@contribution.hub)
      @contribution.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    private

    def set_contribution
      @contribution = Contribution.accessible_by(current_user).find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end

    def update_params
      params.require(:contribution).permit(:active, :priority_tier)
    end

    def custom_filter_mappings
      {
        platforms: {
          type: :custom,
          method: :filter_by_platform
        },
        participants: {
          type: :custom,
          method: :filter_by_participant_type
        }
      }.merge(topics_filter_mapping)
    end

    def filter_by_platform(collection, value)
      platforms = value.split(",").select { |platform| !platform.blank? }.collect { |platform| platform.strip.downcase }
      collection
        .includes(message: :conversation)
        .references(:conversations)
        .where(conversations: {platform: platforms})
    end

    # The user sort is mapped to participant_id by adjust_sort_by; it sorts by the participant's name instead
    def apply_custom_sort(collection, sort_by, sort_direction)
      return super unless sort_by == "conversations.participant_id"

      collection.ordered_by_participant_name(sort_direction)
    end

    def adjust_sort_by
      params[:sort_by] = "conversations.participant_id" if params[:sort_by].to_s == "user"
      params[:sort_by] = "conversations.platform" if params[:sort_by].to_s == "platform"
      params[:sort_by] = "contributions.#{params[:sort_by]}" if params[:sort_by].present? && !params[:sort_by].to_s.include?(".")
    end
  end
end
