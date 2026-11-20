module Api
  class MessageReportsController < AuthenticatedController
    def create
      message = Message.find(params[:message_id])
      return unless require_member!(message.conversation.hub)

      report = MessageReport.new(create_params.merge(message_id: message.id, reported_by: current_user))

      if report.save
        render json: report.as_json(only: [:id, :message_id, :comment, :created_at]), status: :created
      else
        render json: {errors: report.errors.full_messages}, status: :unprocessable_content
      end
    end

    private

    def create_params
      params.require(:message_report).permit(:comment)
    end
  end
end
