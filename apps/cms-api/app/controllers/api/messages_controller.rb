module Api
  class MessagesController < AuthenticatedController
    def index
      @conversation = conversation(params[:conversation_id])
      return unless @conversation
      return unless require_member!(@conversation.hub)

      messages = @conversation.messages.includes(:topics, message_data_source_items: :item)
      paginated_messages = paginate(messages)
      render json: paginated_messages
    end

    def create
      @conversation = conversation(params[:message][:conversation_id])
      return unless @conversation
      return unless require_member!(@conversation.hub)
      unless current_user == @conversation.participant
        render json: {error: I18n.t(:error_permission)}, status: :forbidden
        return
      end

      @message = Message.new(create_params)
      @message.direction = "incoming"

      if @message.save
        render json: @message.as_json(only: [:id, :conversation_id, :direction, :body, :created_at, :updated_at]), status: :created
      else
        render json: {errors: @message.errors.full_messages}, status: :unprocessable_content
      end
    end

    def callback
      @conversation = conversation(Message.find_by(id: params[:id])&.conversation_id)
      return unless @conversation
      return unless require_member!(@conversation.hub)
      unless current_user == @conversation.participant
        render json: {error: I18n.t(:error_permission)}, status: :forbidden
        return
      end

      internal_service = WebhookServices::InternalService.new(callback_params)

      if internal_service.valid?
        internal_service.process(@conversation)
        head :ok
      else
        head :bad_request
      end
    end

    private

    def conversation(conversation_id)
      Conversation.not_deleted.readable_by(current_user).find(conversation_id.to_i)
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
      nil
    end

    def create_params
      params.require(:message).permit(:conversation_id, :body)
    end

    def callback_params
      params.require(:callback).permit(:id, :type)
    end
  end
end
