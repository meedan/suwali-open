class MessageDataSourceItem < ApplicationRecord
  belongs_to :message
  belongs_to :item, polymorphic: true, optional: true

  before_validation :copy_item_title, on: :create

  validates :message_id, presence: true
  validates :item_type, presence: true
  validates :item_id, presence: true
  validates :item_title, presence: true

  validates :item_id, uniqueness: {
    scope: [:message_id, :item_type]
  }

  delegate :hub, to: :message

  ALLOWED_ITEM_TYPES = %w[Document Contribution Notebook].freeze
  validates :item_type, inclusion: {in: ALLOWED_ITEM_TYPES}

  def is_public_source_document?
    item.is_a?(Document) && item.public_source?
  end

  def data_source_payload
    {
      type: item_type,
      id: item_id,
      title: item_title,
      deleted: item.nil?
    }
  end

  def top_data_source_items_payload
    {
      id: item_id,
      type: item_type,
      title: item_title,
      usage_count: self[:usage_count],
      active: self[:active],
      deleted: self[:active].nil?,
      priority_tier: self[:priority_tier]
    }.with_indifferent_access
  end

  private

  def copy_item_title
    self.item_title ||= item.title.to_s
  end
end
