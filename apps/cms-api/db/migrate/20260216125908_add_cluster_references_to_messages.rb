class AddClusterReferencesToMessages < ActiveRecord::Migration[7.1]
  def change
    add_reference :messages,
      :message_cluster,
      foreign_key: {on_delete: :nullify, name: :fk_messages_message_cluster},
      index: true
  end
end
