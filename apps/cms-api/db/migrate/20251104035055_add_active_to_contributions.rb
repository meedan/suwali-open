class AddActiveToContributions < ActiveRecord::Migration[7.1]
  def change
    add_column :contributions, :active, :boolean, default: true, null: false
  end
end
