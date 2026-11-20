class CreateBulkConversationExports < ActiveRecord::Migration[7.1]
  def up
    create_table :bulk_conversation_exports do |t|
      t.references :hub, null: false, foreign_key: true
      t.references :requested_by, null: false, foreign_key: {to_table: :users}
      t.integer :status, null: false, default: 0

      t.timestamps
    end

    execute "SELECT audit.add_audit_trigger('public', 'bulk_conversation_exports');"
  end

  def down
    drop_table :bulk_conversation_exports
  end
end
