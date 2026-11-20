class AddResourceTypeToExternalResources < ActiveRecord::Migration[7.1]
  def change
    add_column :external_resources, :resource_type, :string
  end
end
