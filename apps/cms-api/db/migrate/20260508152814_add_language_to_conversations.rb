class AddLanguageToConversations < ActiveRecord::Migration[7.1]
  def change
    add_column :conversations, :language, :string, default: "en", null: false
  end
end
