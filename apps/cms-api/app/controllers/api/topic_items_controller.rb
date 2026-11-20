module Api
  class TopicItemsController < AuthenticatedController
    # Adds a topic of the hub to an item: the one with the topic_id, or the one named topic_name, which is created
    # if the hub has no topic of that name, whatever the case.
    def create
      unless TopicItem::DATA_SOURCE_ITEM_TYPES.include?(params[:item_type])
        return render json: {errors: [I18n.t(:error_topic_item_type_not_allowed)]}, status: :unprocessable_content
      end

      # Loaded through the polymorphic association, as Brakeman flags constantize on a param
      item = TopicItem.new(item_type: params[:item_type], item_id: params[:item_id]).item
      raise ActiveRecord::RecordNotFound unless item
      hub = item.hub
      return unless require_member!(hub)

      if params.key?(:topic_name)
        add_topic_named(hub, params[:topic_name].to_s.squish)
      else
        add_topic_to_item(hub.topics.find(params[:topic_id]))
      end
    end

    def destroy
      topic_item = TopicItem.find(params[:id])
      return unless require_member!(topic_item.hub)

      topic_item.destroy!
      render json: {message: I18n.t(:message_deleted)}, status: :ok
    end

    private

    def add_topic_named(hub, name)
      topic = hub.topics.named_ignoring_case(name).first
      return add_topic_to_item(topic) if topic

      # Any member can apply a topic the hub has, but creating one adds to the topics of the whole hub, so is for admins
      return unless require_admin!(hub)

      add_topic_to_item(hub.topics.create!(name: name), topic_created: true)
    end

    # Added by a person, who is not announcing new content, so subscribers to the topic are not notified. The
    # topic and the item belonging to the same hub is validated by the model.
    def add_topic_to_item(topic, topic_created: false)
      topic_item = topic.topic_items.new(item_type: params[:item_type], item_id: params[:item_id], added_by: current_user, skip_notifications: true)

      if topic_item.save
        render json: topic_item.as_json.merge(topic_created: topic_created), status: :created
      else
        render json: {errors: topic_item.errors.full_messages}, status: :unprocessable_content
      end
    end
  end
end
