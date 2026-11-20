class CreateHubMemberships < ActiveRecord::Migration[7.1]
  def change
    create_table :hub_memberships do |t|
      t.references :user, null: false, foreign_key: true
      t.references :hub, null: false, foreign_key: true

      t.timestamps
      t.index [:user_id, :hub_id], unique: true
    end
  end
end
