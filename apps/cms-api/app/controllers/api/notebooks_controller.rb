module Api
  class NotebooksController < AuthenticatedController
    include Filterable
    include KnowledgeServiceRetryable
    before_action :set_notebook, only: [:show, :update, :destroy, :regenerate_ai_summary]

    def show
      return unless require_member!(@notebook.hub)
      render json: @notebook.as_json(include_user: true, include_summarizable: true), status: :ok
    end

    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      notebooks = if params[:published].to_s == "true"
        hub.notebooks.published_for(current_user).includes(user: {profile_picture_attachment: :blob}).includes(last_summary_updated_by: {profile_picture_attachment: :blob}).includes(topic_items: :topic)
      else
        Notebook.where(hub_id: params[:hub_id].to_i, user: current_user).includes(:user).includes(last_summary_updated_by: {profile_picture_attachment: :blob}).includes(topic_items: :topic)
      end

      # The count before filtering, which the list's total is not once it is filtered
      unfiltered_count = notebooks.count

      notebooks = paginate(apply_filters(notebooks))

      render json: {
        data: notebooks[:data].as_json(include_user: true),
        pagination: notebooks[:pagination].merge(unfiltered_count: unfiltered_count)
      }
    end

    def create
      hub = Hub.find(params[:notebook][:hub_id].to_i)
      return unless require_member!(hub)

      @notebook = Notebook.new(create_params)
      @notebook.user = current_user

      if @notebook.save
        render json: @notebook.as_json(include_user: true), status: :created
      else
        render json: {errors: @notebook.errors.full_messages}, status: :unprocessable_content
      end
    end

    def update
      return unless require_member!(@notebook.hub)

      if @notebook.update(update_params.merge(summary_updater: current_user))
        render json: @notebook.as_json(include_user: true), status: :ok
      else
        render json: {errors: @notebook.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      return unless require_member!(@notebook.hub)

      @notebook.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    def regenerate_ai_summary
      return unless require_member!(@notebook.hub)

      @notebook.schedule_regenerate_ai_summary!
      render json: {acknowledged: true}, status: :accepted
    end

    private

    def set_notebook
      @notebook = Notebook.accessible_by(current_user).find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end

    def create_params
      params.require(:notebook).permit(:hub_id, :name)
    end

    def update_params
      params.require(:notebook).permit(:name, :summary, :published, :active, :priority_tier)
    end

    def custom_filter_mappings
      {
        published_by: {
          type: :custom,
          method: :filter_by_publisher,
          reset_value: :any
        },
        date_published: {
          type: :custom,
          method: :filter_by_date_published,
          reset_value: :any
        }
      }.merge(topics_filter_mapping)
    end

    # The last editor is shown by name, falling back to email; notebooks nobody edited come last
    def apply_custom_sort(collection, sort_by, sort_direction)
      return super unless sort_by == "last_summary_updated_by_id"

      collection.ordered_by_last_editor_name(sort_direction)
    end

    def filter_by_date_published(collection, value)
      filter_by_date(collection, :published_at, value)
    end

    def filter_by_publisher(collection, value)
      ids = value.split(",").select { |id| !id.blank? }.collect { |id| id.strip.to_i }.uniq
      collection.where(last_summary_updated_by_id: ids)
    end
  end
end
