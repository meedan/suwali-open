module Api
  class TopicsController < AuthenticatedController
    def index
      hub = Hub.find(params[:hub_id].to_i)
      return unless require_member!(hub)

      if params[:item_type].present? && !TopicItem::DATA_SOURCE_ITEM_TYPES.include?(params[:item_type])
        return render json: {errors: [I18n.t(:error_topic_item_type_not_allowed)]}, status: :unprocessable_content
      end

      list = listed_items(hub)

      # By name, which is unique within a hub, so the pages are stable
      topics = hub.topics.order(:name)
      topics = topics.where(id: topic_ids) if params[:ids].present?
      topics = topics.where("topics.name ILIKE ?", "%#{Topic.sanitize_sql_like(params[:q].to_s.strip)}%") if params[:q].present?
      topics = topics.where(id: TopicItem.of_items(list).select(:topic_id)) if list && !params[:ids].present?

      result = paginate(topics)
      page_topics = result[:data].to_a
      items_counts = count_items(page_topics, list)

      render json: {
        data: page_topics.map { |topic| {id: topic.id, name: topic.name, items_count: items_counts.fetch(topic.id, 0)} },
        pagination: result[:pagination]
      }.merge(list ? {untagged_count: list.untagged.count} : {})
    end

    private

    def topic_ids
      params[:ids].to_s.split(",").filter_map { |id| Integer(id.strip, exception: false) }
    end

    def listed_items(hub)
      case params[:item_type]
      when "Document"
        hub.sources.find(params[:source_id]).documents.excluding_non_retryable
      when "Contribution"
        hub.contributions
      when "Notebook"
        hub.notebooks.published_for(current_user)
      end
    end

    def count_items(page_topics, list)
      page_topic_ids = page_topics.map(&:id)
      return TopicItem.of_items(list).where(topic_id: page_topic_ids).group(:topic_id).count if list

      # Messages are left out, so the counts are not inflated by the topics of bot answers
      TopicItem.where(topic_id: page_topic_ids, item_type: TopicItem::DATA_SOURCE_ITEM_TYPES).group(:topic_id).count
    end
  end
end
