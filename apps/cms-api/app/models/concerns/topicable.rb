module Topicable
  extend ActiveSupport::Concern

  # Mirrors Knowledge Service's topic_extraction_max_count (apps/knowledge/app/core/config.py)
  MAX_TOPICS = 5
  MAX_TOPIC_NAME_LENGTH = 255

  included do
    has_many :topic_items, as: :item, dependent: :destroy
    has_many :topics, through: :topic_items
    has_many :deleted_topic_items, as: :item, dependent: :delete_all
    has_many :removed_topics, through: :deleted_topic_items, source: :topic

    # A subquery, not a join, so an item with two of the topics is still one row for pagination
    scope :tagged_with, ->(topic_ids) { where(id: TopicItem.where(item_type: polymorphic_name, topic_id: topic_ids).select(:item_id)) }

    # NOT EXISTS rather than NOT IN, which Postgres can't plan as an anti-join
    scope :untagged, -> {
      where("NOT EXISTS (SELECT 1 FROM topic_items WHERE topic_items.item_type = ? AND topic_items.item_id = #{quoted_table_name}.id)", polymorphic_name)
    }
  end

  def assign_topic_names(names)
    return unless hub && names.is_a?(Array)

    clean_names = clean_topic_names(names)
    return if clean_names.empty?

    self.topics = (generated_topics(clean_names) + topics.merge(TopicItem.user_added)).uniq
  end

  def sorted_topic_items
    if topic_items.loaded?
      # Sort in Ruby when preloaded to avoid N+1; revisit when topic_items are paginated
      topic_items.sort_by { |ti| ti.topic&.name.to_s }
    else
      topic_items.includes(:topic).order("topics.name")
    end
  end

  private

  def clean_topic_names(names)
    truncate_topic_names(cap_topics(names.map(&:to_s).map(&:strip).reject(&:blank?).uniq))
  end

  def generated_topics(names)
    names.map { |name| hub.topics.named_ignoring_case(name).first || hub.topics.create!(name: name) } - removed_topics
  end

  def cap_topics(names)
    return names if names.size <= MAX_TOPICS

    LogService.log(:warn, "Topicable", "assign_topic_names received #{names.size} names, capping at #{MAX_TOPICS}")
    names.first(MAX_TOPICS)
  end

  def truncate_topic_names(names)
    names.map do |name|
      next name if name.length <= MAX_TOPIC_NAME_LENGTH

      LogService.log(:warn, "Topicable", "assign_topic_names received a name longer than #{MAX_TOPIC_NAME_LENGTH} characters, truncating")
      name[0, MAX_TOPIC_NAME_LENGTH]
    end.uniq
  end
end
