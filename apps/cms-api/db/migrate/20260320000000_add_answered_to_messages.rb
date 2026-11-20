class AddAnsweredToMessages < ActiveRecord::Migration[7.1]
  def change
    add_column :messages, :answered, :boolean, default: nil
    add_index :messages, :answered, where: "answered IS NOT NULL"
  end
end
