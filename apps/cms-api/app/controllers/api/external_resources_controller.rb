module Api
  class ExternalResourcesController < AuthenticatedController
    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      external_resources = ExternalResource.where(hub_id: params[:hub_id].to_i).order(created_at: :desc)
      render json: external_resources.as_json
    end

    def create
      hub = Hub.find(params[:external_resource][:hub_id].to_i)
      return unless require_admin!(hub)

      @external_resource = ExternalResource.new(create_params)

      if @external_resource.save
        render json: @external_resource, status: :created
      else
        render json: {errors: @external_resource.errors.full_messages}, status: :unprocessable_content
      end
    end

    def update
      @external_resource = ExternalResource.find(params[:id])
      return unless require_admin!(@external_resource.hub)

      if @external_resource.update(update_params)
        render json: @external_resource, status: :ok
      else
        render json: {errors: @external_resource.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      @external_resource = ExternalResource.find(params[:id])
      return unless require_admin!(@external_resource.hub)

      @external_resource.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    private

    def create_params
      params.require(:external_resource).permit(:hub_id, :title, :resource_type, :description, scenarios: [])
    end

    def update_params
      params.require(:external_resource).permit(:title, :description, scenarios: [])
    end
  end
end
