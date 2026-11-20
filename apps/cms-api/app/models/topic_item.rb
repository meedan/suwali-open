class TopicItem < ApplicationRecord
  # The topics of Messages come from the bot's answers; those of data source items can also be managed by people
  DATA_SOURCE_ITEM_TYPES = %w[Document Contribution Notebook].freeze
  ALLOWED_ITEM_TYPES = (DATA_SOURCE_ITEM_TYPES + %w[Message]).freeze

  scope :of_items, ->(items) { where(item_type: items.klass.polymorphic_name, item_id: items.select(:id)) }
  scope :user_added, -> { where.not(added_by_id: nil) }

  belongs_to :topic
  belongs_to :item, polymorphic: true
  belongs_to :added_by, class_name: "User", optional: true

  delegate :hub, to: :topic

  validates :item_type, inclusion: {in: ALLOWED_ITEM_TYPES}
  validates :item_id, uniqueness: {scope: [:item_type, :topic_id]}
  validate :item_in_topic_hub

  # Set on a record to skip notifying subscribers when it is created. Unlike without_notifications, it is still in
  # effect when the callback runs after the commit of a transaction wrapping the whole request, as in the controllers.
  attr_accessor :skip_notifications

  after_create :clear_deleted_topic_item
  after_destroy :create_deleted_topic_item, unless: :destroyed_by_association
  after_commit :notify_topic_subscribers, on: :create
  after_commit :sync_item_topics, on: [:create, :destroy], if: -> { user_added? || user_removed? || topic_destroyed? }

  delegate :name, to: :topic

  # topic_id lets a list be filtered by the topic; id is what removes it from the item
  def as_json(_options = {})
    {id: id, topic_id: topic_id, name: name}
  end

  # Run the block without notifying topic subscribers about any TopicItems created within it.
  # Used by the topics backfill: assigning topics to pre-existing items shouldn't message subscribers.
  def self.without_notifications
    previous = Thread.current[:topic_item_skip_notifications]
    Thread.current[:topic_item_skip_notifications] = true
    yield
  ensure
    Thread.current[:topic_item_skip_notifications] = previous
  end

  private

  def clear_deleted_topic_item
    topic.deleted_topic_items.where(item: item).delete_all
  end

  def create_deleted_topic_item
    topic.deleted_topic_items.create!(item: item)
  end

  def user_added?
    !destroyed? && added_by_id?
  end

  def user_removed?
    destroyed? && !destroyed_by_association
  end

  def topic_destroyed?
    destroyed? && destroyed_by_association&.active_record == Topic
  end

  def sync_item_topics
    item.sync_topics_to_knowledge_service if item_type.in?(DATA_SOURCE_ITEM_TYPES)
  end

  def notify_topic_subscribers
    return if skip_notifications || Thread.current[:topic_item_skip_notifications]

    # Only public-source documents produce notifications, so skip enqueuing a job that would just
    # no-op for anything else (message topics, contributions, notebooks, private documents).
    return unless item.is_a?(Document) && item.public_source?

    TopicSubscriptionNotificationWorker.perform_async(id)
  end

  def item_in_topic_hub
    return unless topic && item

    if topic.hub_id != item.hub&.id
      errors.add(:item, I18n.t(:error_topic_item_hub_mismatch))
    end
  end
end
