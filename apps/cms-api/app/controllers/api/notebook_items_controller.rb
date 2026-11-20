module Api
  class NotebookItemsController < AuthenticatedController
    skip_hub_authorization :index

    ALLOWED_ITEM_TYPES = {
      "Message" => Message,
      "Conversation" => Conversation,
      "Document" => Document,
      "Contribution" => Contribution,
      "MessageCluster" => MessageCluster,
      "Notebook" => Notebook
    }.freeze

    def index
      items = nil
      if params[:notebook_id]
        items = list_items_for_notebook(params[:notebook_id].to_i)
      elsif params[:item_notebook_id]
        items = list_items_for_notebook_as_item(params[:item_notebook_id])
      elsif params[:document_id]
        items = list_items_for_asset(Document, params[:document_id])
      elsif params[:conversation_id]
        items = list_items_for_asset(Conversation, params[:conversation_id])
      elsif params[:message_id]
        items = list_items_for_asset(Message, params[:message_id])
      elsif params[:contribution_id]
        items = list_items_for_asset(Contribution, params[:contribution_id])
      elsif params[:message_cluster_id]
        items = list_items_for_asset(MessageCluster, params[:message_cluster_id])
      end

      if items.nil?
        return render json: {error: I18n.t(:error_not_found)}, status: :not_found
      end

      render json: items
    end

    def create
      notebook = Notebook.find(params[:notebook_id])
      return unless require_member!(notebook.hub)

      item_class = ALLOWED_ITEM_TYPES[params.require(:item_type).to_s]
      return render json: {error: I18n.t(:error_item_type)}, status: :unprocessable_content unless item_class
      item = find_readable_item(item_class, params.require(:item_id))
      return render json: {error: I18n.t(:error_not_found)}, status: :not_found unless item
      return unless require_member!(item.hub)

      @item = NotebookItem.new(notebook_id: params[:notebook_id], item: item)

      if @item.save
        render json: @item, status: :created
      else
        render json: {errors: @item.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      @notebook = Notebook.find(params[:notebook_id])
      return unless require_member!(@notebook.hub)
      @item = @notebook.notebook_items.find(params[:id])

      @item.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    private

    def list_items_for_notebook(notebook_id)
      @notebook = Notebook.find(notebook_id)
      return nil unless current_user.can_access_hub?(@notebook.hub)

      items = @notebook.items.visible.includes(:item).order(updated_at: :desc).to_a
      NotebookItem.preload_items(items)
      items.as_json(include_item: true)
    end

    def list_items_for_notebook_as_item(notebook_id)
      @notebook = Notebook.find(notebook_id)
      return nil unless current_user.can_access_hub?(@notebook.hub)

      items = @notebook.items_as_item.order(updated_at: :desc).to_a
      NotebookItem.preload_items(items)
      items.as_json(include_item: true)
    end

    def list_items_for_asset(asset_class, asset_id)
      asset = find_readable_item(asset_class, asset_id)
      return nil unless asset && current_user.can_access_hub?(asset.hub)

      items = asset.notebook_items.includes(:notebook).order(updated_at: :desc)
      items.as_json(include_notebook: true)
    end

    def find_readable_item(item_class, id)
      scope = item_class.respond_to?(:readable_by) ? item_class.readable_by(current_user) : item_class
      scope.find_by(id: id.to_i)
    end
  end
end
