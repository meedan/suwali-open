class AddMetadataToMessages < ActiveRecord::Migration[7.1]
  def change
    add_column :messages, :metadata, :jsonb, null: false, default: {}
  end
end
