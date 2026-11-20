module Api
  class DocumentsController < AuthenticatedController
    include Filterable
    include KnowledgeServiceRetryable
    before_action :set_source, only: [:index]
    before_action :set_document, only: [:show, :update, :destroy, :refresh]

    def show
      return unless require_member!(@document.hub)
      render json: @document.as_json, status: :ok
    end

    def index
      return unless require_member!(@source.hub)

      documents = apply_filters(@source.documents.excluding_non_retryable.includes(file_attachment: :blob, topic_items: :topic))
      render json: paginate(documents)
    end

    def update
      return unless require_member!(@document.hub)
      if @document.update(update_params)
        render json: @document.as_json, status: :ok
      else
        render json: {errors: @document.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      return unless require_member!(@document.hub)
      @document.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    def refresh
      return unless require_member!(@document.hub)

      if @document.error? || @document.pending?
        return render json: {error: I18n.t(:error_not_refreshable)}, status: :unprocessable_content
      end

      handler = @document.source.handler
      unless handler.try(:refresh_supported?)
        return render json: {error: I18n.t(:error_refresh_not_supported)}, status: :unprocessable_content
      end

      DocumentRefreshWorker.perform_async(@document.id)
      render json: {success: true}, status: :accepted
    end

    private

    def set_source
      @source = Source.accessible_by(current_user).find(params[:source_id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end

    def set_document
      @document = Document.accessible_by(current_user).find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end

    def update_params
      params.require(:document).permit(:active, :priority_tier, :summary)
    end

    def custom_filter_mappings
      {
        date_published: {
          type: :custom,
          method: :filter_by_date_published,
          reset_value: :any
        }
      }.merge(topics_filter_mapping)
    end

    def apply_custom_sort(collection, sort_by, sort_direction)
      return super unless sort_by == "published_at"

      collection.ordered_by_published_at(sort_direction)
    end

    def filter_by_date_published(collection, value)
      filter_by_date(collection, :published_at, value)
    end
  end
end
