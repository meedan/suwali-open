module MessageDataSourceItemable
  extend ActiveSupport::Concern

  included do
    has_many :message_data_source_items, as: :item
    has_many :messages, through: :message_data_source_items

    after_update_commit :sync_message_data_source_item_titles
  end

  private

  def sync_message_data_source_item_titles
    message_data_source_items.update_all(item_title: title.to_s)
  end
end
