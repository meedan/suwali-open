module Api
  class ConversationsController < AuthenticatedController
    include Filterable

    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      conversations = Conversation.not_deleted.where(hub_id: params[:hub_id].to_i).preload(:participant)
      conversations = conversations.listed_for(current_user) unless params[:from] == "me"
      adjust_sort_by
      conversations = paginate(apply_filters(conversations))
      users = conversations[:data].map(&:participant).select { |p| p.is_a?(User) }
      ActiveRecord::Associations::Preloader.new(records: users, associations: :profile_picture_attachment).call if users.any?
      render json: conversations.merge(data: conversations[:data].map { |c| conversation_json(c) })
    end

    def my_conversations
      hub = Hub.find(params[:id].to_i)
      return unless require_member!(hub)

      conversations = Conversation.not_deleted.where(hub_id: params[:id].to_i, participant: current_user).preload(:participant)
      conversations = paginate(conversations)
      render json: conversations.as_json
    end

    def show
      conversation = Conversation.not_deleted.readable_by(current_user).find_by(id: params[:id].to_i)

      if conversation.nil?
        return render json: {error: I18n.t(:error_not_found)}, status: :not_found
      end

      return unless require_member!(conversation.hub)

      render json: conversation_json(conversation)
    end

    def export
      return unless require_super_admin!

      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      conversation = hub.conversations.not_deleted.find_by(id: params[:id].to_i)
      return render json: {errors: [I18n.t(:error_not_found)]}, status: :not_found if conversation.nil?

      csv = ConversationCsvExporter.new([conversation]).generate
      send_data csv, type: "text/csv", disposition: "attachment", filename: "suwali-conversation-#{conversation.id}-export-#{Date.today}.csv"
    end

    def bulk_export
      return unless require_super_admin!

      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      export = hub.bulk_conversation_exports.pending.last || create_bulk_export(hub)
      render json: export.as_json, status: :accepted
    end

    def latest_bulk_export
      return unless require_super_admin!

      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      render json: hub.bulk_conversation_exports.last&.as_json
    end

    def create
      hub = Hub.find(params[:conversation][:hub_id].to_i)
      return unless require_member!(hub)

      @conversation = Conversation.new(create_params)
      @conversation.participant = current_user
      @conversation.platform = "internal"

      if @conversation.save
        render json: @conversation.as_json(only: [:id, :hub_id, :participant_id, :participant_type, :title, :platform, :created_at, :updated_at]), status: :created
      else
        render json: {errors: @conversation.errors.full_messages}, status: :unprocessable_content
      end
    end

    def update
      @conversation = Conversation.not_deleted.find(params[:id])
      return unless require_member!(@conversation.hub)

      unless current_user == @conversation.participant
        render json: {error: I18n.t(:error_permission)}, status: :forbidden
        return
      end

      if @conversation.update(update_params)
        render json: @conversation.as_json(only: [:id, :hub_id, :participant_id, :participant_type, :title, :platform, :created_at, :updated_at]), status: :ok
      else
        render json: {errors: @conversation.errors.full_messages}, status: :unprocessable_content
      end
    end

    def destroy
      @conversation = Conversation.not_deleted.find(params[:id])
      return unless require_member!(@conversation.hub)

      unless @conversation.deletable_by?(current_user)
        render json: {error: I18n.t(:error_permission)}, status: :forbidden
        return
      end

      @conversation.destroy_async!
      render json: {message: I18n.t(:message_deleted)}, status: :accepted
    end

    private

    def create_params
      params.require(:conversation).permit(:hub_id, :title)
    end

    def update_params
      params.require(:conversation).permit(:title)
    end

    def create_bulk_export(hub)
      BulkConversationExport.transaction(requires_new: true) { hub.bulk_conversation_exports.create!(requested_by: current_user) }
    rescue ActiveRecord::RecordNotUnique
      hub.bulk_conversation_exports.last
    end

    def custom_filter_mappings
      {
        first_message: {
          type: :custom,
          method: :filter_by_first_message,
          reset_value: :any
        },
        has_message: {
          type: :custom,
          method: :filter_by_any_message
        },
        last_message: {
          type: :custom,
          method: :filter_by_last_message,
          reset_value: :any
        },
        participants: {
          type: :custom,
          method: :filter_by_participant_type
        },
        platforms: {
          type: :custom,
          method: :filter_by_platform,
          reset_value: :any
        },
        from: {
          type: :custom,
          method: :filter_by_from,
          reset_value: :any
        }
      }
    end

    def filter_by_first_message(collection, value)
      filter_by_date(collection, "conversations.created_at", value)
    end

    def filter_by_last_message(collection, value)
      filter_by_date(collection, "conversations.updated_at", value)
    end

    def filter_by_any_message(collection, value)
      from, to = value.split(",").map(&:strip)
      in_range = Message.where(created_at: Time.parse(from).beginning_of_day..Time.parse(to).end_of_day)
      collection.where(in_range.where(Message.arel_table[:conversation_id].eq(Conversation.arel_table[:id])).arel.exists)
    end

    def filter_by_platform(collection, value)
      platforms = value.split(",").select { |platform| !platform.blank? }.collect { |platform| platform.strip.downcase }
      collection.where(platform: platforms)
    end

    def filter_by_from(collection, value)
      return collection if value.blank?

      case value.to_s.strip.downcase
      when "me"
        collection.where(participant: current_user)
      when "audience"
        collection.where.not(platform: "internal")
      when "team"
        collection.where(platform: "internal").where("conversations.messages_count > 0")
      end
    end

    # The user sort is mapped to participant_id by adjust_sort_by; it sorts by the participant's name instead
    def apply_custom_sort(collection, sort_by, sort_direction)
      return super unless sort_by == "conversations.participant_id"

      collection.ordered_by_participant_name(sort_direction)
    end

    def adjust_sort_by
      params[:sort_by] = "conversations.updated_at" if params[:sort_by].blank? || params[:sort_by].to_s == "last_message"
      params[:sort_by] = "conversations.participant_id" if params[:sort_by].to_s == "user"
      params[:sort_by] = "conversations.#{params[:sort_by]}" if params[:sort_by].present? && !params[:sort_by].to_s.include?(".")
    end

    # Trimmed shape shared by index and show, not the model's as_json; an untrusted end-user's external_id is left out
    def conversation_json(conversation)
      {
        id: conversation.id,
        hub_id: conversation.hub_id,
        title: conversation.title,
        platform: conversation.platform,
        created_at: conversation.created_at,
        updated_at: conversation.updated_at,
        context: conversation.context,
        participant_id: conversation.participant_id,
        participant: participant_json(conversation.participant)
      }
    end

    def participant_json(participant)
      if participant.is_a?(User)
        {
          id: participant.id,
          type: "User",
          name: participant.name,
          email: participant.email,
          profile_picture_url: participant.profile_picture_url
        }
      elsif participant.is_a?(ExternalUser)
        {
          id: participant.id,
          type: "ExternalUser",
          name: participant.effective_display_name,
          trusted_user: participant.trusted_user,
          external_id: participant.trusted_user ? participant.external_id : nil,
          first_message_at: participant.first_message_at,
          last_message_at: participant.last_message_at,
          messages_count: participant.messages_count,
          platform: participant.platform
        }
      end
    end
  end
end
