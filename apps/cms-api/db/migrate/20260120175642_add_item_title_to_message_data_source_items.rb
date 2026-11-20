class AddItemTitleToMessageDataSourceItems < ActiveRecord::Migration[7.1]
  def up
    add_column :message_data_source_items, :item_title, :string
    add_index :message_data_source_items, :item_title

    MessageDataSourceItem.reset_column_information

    MessageDataSourceItem.find_each do |mdsi|
      if mdsi.item
        mdsi.update_column(:item_title, mdsi.item.title.to_s)
      else
        mdsi.update_column(:item_title, "")
      end
    end

    change_column_null :message_data_source_items, :item_title, false
  end

  def down
    remove_index :message_data_source_items, :item_title
    remove_column :message_data_source_items, :item_title
  end

  class MessageDataSourceItem < ApplicationRecord
    self.table_name = "message_data_source_items"
    belongs_to :item, polymorphic: true
  end

  class Document < ApplicationRecord
    self.table_name = "documents"
  end

  class Contribution < ApplicationRecord
    self.table_name = "contributions"
  end

  class Notebook < ApplicationRecord
    self.table_name = "notebooks"
  end
end
