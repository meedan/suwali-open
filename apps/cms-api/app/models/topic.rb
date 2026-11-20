class Topic < ApplicationRecord
  belongs_to :hub

  has_many :topic_items, dependent: :destroy
  has_many :deleted_topic_items, dependent: :delete_all
  has_many :topic_subscriptions, dependent: :destroy
  has_many :subscribers, through: :topic_subscriptions, source: :external_user

  validates :name, presence: true, uniqueness: {scope: :hub_id}, length: {maximum: Topicable::MAX_TOPIC_NAME_LENGTH}

  # Names are only unique exactly, so this finds a "Climate" for "climate" too
  scope :named_ignoring_case, ->(name) { where("LOWER(topics.name) = LOWER(?)", name) }
end
