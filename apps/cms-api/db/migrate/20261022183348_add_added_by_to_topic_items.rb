class AddAddedByToTopicItems < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    add_reference :topic_items, :added_by, index: {algorithm: :concurrently}, foreign_key: {to_table: :users, on_delete: :nullify}
  end
end
