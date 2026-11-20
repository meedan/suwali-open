class DeletedTopicItem < ApplicationRecord
  belongs_to :topic
  belongs_to :item, polymorphic: true

  validates :item_id, uniqueness: {scope: [:item_type, :topic_id]}
end
