class AddPreloadedToSources < ActiveRecord::Migration[7.1]
  def change
    add_column :sources, :preloaded, :boolean, default: false, null: false
  end
end
