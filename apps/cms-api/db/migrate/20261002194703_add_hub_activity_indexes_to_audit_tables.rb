class AddHubActivityIndexesToAuditTables < ActiveRecord::Migration[7.1]
  disable_ddl_transaction!

  def change
    add_index "audit.hubs_log", "(new_data->>'id')", name: "hubs_log_new_id_idx", algorithm: :concurrently
    add_index "audit.hubs_log", "(old_data->>'id')", name: "hubs_log_deleted_id_idx", where: "operation = 'DELETE'", algorithm: :concurrently

    %w[hub_memberships_log sources_log messaging_integrations_log].each do |table|
      add_index "audit.#{table}", "(new_data->>'hub_id')", name: "#{table}_inserted_hub_id_idx", where: "operation = 'INSERT'", algorithm: :concurrently
      add_index "audit.#{table}", "(old_data->>'hub_id')", name: "#{table}_deleted_hub_id_idx", where: "operation = 'DELETE'", algorithm: :concurrently
    end

    # '2' is Document.sync_statuses[:complete]; the predicate must match the literal used in queries
    add_index "audit.documents_log", "(new_data->>'source_id')", name: "documents_log_synced_source_id_idx", where: "new_data->>'sync_status' = '2'", algorithm: :concurrently

    add_index "audit.users_log", "(new_data->>'id')", name: "users_log_inserted_id_idx", where: "operation = 'INSERT'", algorithm: :concurrently
  end
end
