module Api
  class SourcesController < AuthenticatedController
    before_action :set_source, only: [:show, :update, :destroy]
    # No DB writes; slow external call would hit Postgres' idle-in-transaction timeout.
    skip_around_action :set_audit_user, only: [:preview, :configure]

    def show
      return unless require_member!(@source.hub)
      render json: @source.as_json, status: :ok
    end

    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      sources = Source.not_deleted.where(hub_id: params[:hub_id].to_i).includes(:non_retryable_documents).order(name: :asc)
      render json: sources.as_json
    end

    def create
      hub = Hub.find(params[:source][:hub_id].to_i)
      return unless require_member!(hub)
      return unless require_admin!(hub)

      @source = Source.new(create_params)

      if @source.uploaded_files? && params[:source][:files].blank?
        return render json: {errors: [I18n.t(:error_uploaded_files_source_type_no_files)]}, status: :unprocessable_content
      end

      hub.with_lock do
        if @source.save
          if @source.uploaded_files?
            upload_files(@source, params[:source][:files])
          end
          render json: @source.reload, status: :created
        else
          render json: {errors: @source.errors.full_messages}, status: :unprocessable_content
        end
      rescue => e
        @source.destroy if @source.persisted?
        render json: {errors: [e.message]}, status: :unprocessable_content
      end
    end

    def update
      return unless require_member!(@source.hub)

      # Editors can pause/unpause (:active), but only admins can change :name, :config, or upload files
      if update_params.key?(:name) || update_params.key?(:config) || params[:source][:files].present?
        return unless require_admin!(@source.hub)
      end

      if @source.update(update_params)
        if @source.uploaded_files? && params[:source][:files].present?
          upload_files(@source, params[:source][:files])
        end
        render json: @source.reload, status: :ok
      else
        render json: {errors: @source.errors.full_messages}, status: :unprocessable_content
      end
    rescue => e
      render json: {errors: [e.message]}, status: :unprocessable_content
    end

    def destroy
      return unless require_member!(@source.hub)
      return unless require_admin!(@source.hub)

      @source.destroy_async!
      render json: {message: I18n.t(:message_deleted)}, status: :accepted
    end

    def preview
      hub = Hub.find(params[:source][:hub_id].to_i)
      return unless require_member!(hub)

      begin
        source = Source.new(create_params)
        # TODO: move away from the Array shape when we work in source ingestion flow overhaul
        # `_` skips google_drive's errors at position 4
        documents, total, suggested_name, _, suggested_url = source.handler.preview
        render json: {documents: documents, total: total, suggested_name: suggested_name, suggested_url: suggested_url}
      rescue => e
        render json: {error: e.message}, status: :unprocessable_content
      end
    end

    def configure
      hub = Hub.find(params[:source][:hub_id].to_i)
      return unless require_member!(hub)

      source = Source.new(create_params)
      handler = source.handler
      if handler&.respond_to?(:configure)
        render json: {configuration: handler.configure}, status: :ok
      else
        render json: {error: I18n.t(:error_unsupported_source_type_for_configuration)}, status: :unprocessable_content
      end
    rescue SourceIngestors::HttpClient::ResponseTooLargeError => e
      render json: {error: e.message, error_code: "content_too_large"}, status: :content_too_large
    rescue SourceIngestors::HttpClient::InvalidUrlError, SourceIngestors::HttpClient::FetchFailedError => e
      LogService.log(:warn, "SourcesController", "configure failed: #{e.message}")
      render json: {error: e.message}, status: :unprocessable_content
    end

    private

    def set_source
      @source = Source.not_deleted.accessible_by(current_user).find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end

    def create_params
      params.require(:source).permit(:hub_id, :name, :source_type, :active, :ownership_receipt, config: {})
    end

    def update_params
      params.require(:source).permit(:name, :active, :ownership_receipt, config: {})
    end

    def upload_files(source, files)
      documents_data, _, _ = SourceIngestors::UploadedFiles.new.call(files: Array(files))

      documents_data.each do |doc_data|
        file = doc_data[:file]
        document = source.documents.create(
          external_id: doc_data[:external_id],
          title: doc_data[:title],
          content: doc_data[:content],
          document_type: doc_data[:document_type]
        )
        next unless document.persisted?

        document.file.attach(
          io: file,
          filename: file.original_filename,
          key: "documents/hub-#{source.hub_id}/document-#{document.id}#{File.extname(file.original_filename)}",
          content_type: Marcel::MimeType.for(file)
        )
        document.update_column(:document_size, document.file.blob.byte_size.to_i)
      end

      source.update!(last_synced_at: Time.current)
    end
  end
end
