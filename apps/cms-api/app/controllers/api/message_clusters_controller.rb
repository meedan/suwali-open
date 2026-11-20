module Api
  class MessageClustersController < AuthenticatedController
    before_action :set_message_cluster

    def messages
      return unless require_member!(@message_cluster.hub)
      answered = params.key?(:answered) ? params[:answered] == "true" : true

      messages = @message_cluster.messages
        .joins(:conversation)
        .in_live_conversations
        .external_with_answered_bot_reply(answered)
        .preload(:reply, conversation: :participant)
      paginated_messages = paginate(messages)

      render json: {
        data: paginated_messages[:data].map(&:cluster_message_payload),
        pagination: paginated_messages[:pagination]
      }
    end

    private

    def set_message_cluster
      @message_cluster = MessageCluster.accessible_by(current_user).find(params[:id])
    rescue ActiveRecord::RecordNotFound
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end
  end
end
