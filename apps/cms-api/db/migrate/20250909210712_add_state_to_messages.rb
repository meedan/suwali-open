class AddStateToMessages < ActiveRecord::Migration[7.1]
  def change
    add_column :messages, :state, :integer
  end
end
