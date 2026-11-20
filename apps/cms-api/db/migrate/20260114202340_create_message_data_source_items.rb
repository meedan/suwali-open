class CreateMessageDataSourceItems < ActiveRecord::Migration[7.1]
  def up
    create_table :message_data_source_items do |t|
      t.references :message, null: false, foreign_key: true
      t.references :item, polymorphic: true, null: false
      t.timestamps
    end

    add_index :message_data_source_items,
      [:message_id, :item_type, :item_id],
      unique: true,
      name: "idx_unique_message_item"

    backfill_message_data_source_items
  end

  def down
    drop_table :message_data_source_items
  end

  private

  class Message < ApplicationRecord
    self.table_name = "messages"
  end

  class MessageDataSourceItem < ApplicationRecord
    self.table_name = "message_data_source_items"
  end

  def backfill_message_data_source_items
    Message.find_each do |message|
      next unless message.direction == 1 # we only want to backfill the messages that are outgoing
      next unless message.metadata.present?

      Array(message.metadata["document_ids_used"]).each do |encoded|
        klass, id = Base64.decode64(encoded).strip.split("/")
        next unless %w[Document Contribution Notebook].include?(klass)
        next unless klass.constantize.exists?(id.to_i)

        MessageDataSourceItem.find_or_create_by!(
          message_id: message.id,
          item_type: klass,
          item_id: id.to_i
        )
      end
    end
  end
end
