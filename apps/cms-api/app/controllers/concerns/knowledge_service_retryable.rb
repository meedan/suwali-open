module KnowledgeServiceRetryable
  extend ActiveSupport::Concern

  included do
    before_action :set_resource_for_retry, only: [:retry_sync]
  end

  def retry_sync
    return unless require_member!(@resource.hub)

    unless @resource.pending? || @resource.retryable?
      render json: {error: I18n.t(:error_not_retryable)}, status: :unprocessable_content
      return
    end

    @resource.reattach_file! if @resource.respond_to?(:reattach_file!)

    if @resource.respond_to?(:file_missing?) && @resource.file_missing?
      render json: {error: I18n.t(:error_not_retryable)}, status: :unprocessable_content
      return
    end

    @resource.update_column(:sync_status, :pending)

    if @resource.active?
      @resource.send(:send_to_knowledge_service)
    else
      @resource.send(:remove_from_knowledge_service)
    end

    render json: {success: true}, status: :accepted
  end

  private

  def set_resource_for_retry
    resource_class = controller_name.classify.constantize
    # retry_sync calls require_member!(@resource.hub) before using it.
    # nosemgrep: unscoped-find-without-hub-authorization
    @resource = resource_class.find(params[:id])
  rescue ActiveRecord::RecordNotFound
    render json: {error: I18n.t(:error_not_found)}, status: :not_found
  end
end
