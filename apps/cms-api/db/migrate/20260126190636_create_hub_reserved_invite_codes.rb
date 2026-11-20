class CreateHubReservedInviteCodes < ActiveRecord::Migration[7.1]
  def change
    create_table :hub_reserved_invite_codes do |t|
      t.string :code, null: false

      t.timestamps
    end

    add_index :hub_reserved_invite_codes, :code, unique: true
  end
end
