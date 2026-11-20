class CreateAuditLoggingInfrastructure < ActiveRecord::Migration[7.1]
  def up
    # audit schema to keep audit tables organized and separate from main public schema tables
    execute <<-SQL
      CREATE SCHEMA IF NOT EXISTS audit;
    SQL

    # generic function to create audit log tables for any table
    # creates: {table_name}_log with id, timestamp, user_id, operation, old/new data as JSONB
    execute <<-SQL
      CREATE OR REPLACE FUNCTION audit.create_log_table(orig_schema text, orig_table_name text)
        RETURNS void
        LANGUAGE plpgsql AS
      $$
      BEGIN
        EXECUTE format('
          CREATE TABLE IF NOT EXISTS audit.%I (
            log_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            log_timestamp timestamptz NOT NULL DEFAULT now(),
            log_user_id bigint,
            operation text NOT NULL,
            old_data jsonb,
            new_data jsonb
          );
          CREATE INDEX IF NOT EXISTS %I ON audit.%I (log_timestamp);
        ',
        orig_table_name || '_log',
        orig_table_name || '_log_timestamp_idx',
        orig_table_name || '_log'
        );
      END;
      $$;
    SQL

    # generic trigger function that logs INSERT/UPDATE/DELETE operations
    # captures the full row as JSONB for before (OLD) and after (NEW) states
    # (postgres gives us TG_ magic)
    execute <<-SQL
      CREATE OR REPLACE FUNCTION audit.on_change_trigger_func()
        RETURNS trigger
        LANGUAGE plpgsql AS
      $$
      DECLARE
        log_table_name text := TG_TABLE_NAME || '_log';
        v_old_data jsonb;
        v_new_data jsonb;
      BEGIN
        -- capture old/new data if we changed/deleted it, otherwise just record new
        IF TG_OP IN ('UPDATE', 'DELETE') THEN
          v_old_data := to_jsonb(OLD);
        END IF;

        IF TG_OP IN ('INSERT', 'UPDATE') THEN
          v_new_data := to_jsonb(NEW);
        END IF;

        -- user id needs to be set via session variable
        EXECUTE format('
          INSERT INTO audit.%I (operation, old_data, new_data, log_user_id)
          VALUES ($1, $2, $3, nullif(current_setting(''audit.current_user_id'', true), '''')::bigint)
        ', log_table_name)
        USING TG_OP, v_old_data, v_new_data;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        ELSE
          RETURN NEW;
        END IF;
      END;
      $$;
    SQL

    # helper function to easily add audit trigger to any table
    # for example, `SELECT audit.add_audit_trigger('public', 'messages');`
    # adds an audit.messages_log table for the public.messages table`
    execute <<-SQL
      CREATE OR REPLACE FUNCTION audit.add_audit_trigger(target_schema text, target_table text)
        RETURNS void
        LANGUAGE plpgsql AS
      $$
      BEGIN
        -- create the log table to put changed data in
        PERFORM audit.create_log_table(target_schema, target_table);

        -- create the trigger that will capture the data on the original table
        EXECUTE format('
          DROP TRIGGER IF EXISTS audit_trigger ON %I.%I;
          CREATE TRIGGER audit_trigger
            AFTER INSERT OR UPDATE OR DELETE ON %I.%I
            FOR EACH ROW
            EXECUTE FUNCTION audit.on_change_trigger_func();
        ', target_schema, target_table, target_schema, target_table);
      END;
      $$;
    SQL

    # helper function to remove audit trigger from a table
    execute <<-SQL
      CREATE OR REPLACE FUNCTION audit.remove_audit_trigger(target_schema text, target_table text)
        RETURNS void
        LANGUAGE plpgsql AS
      $$
      BEGIN
        EXECUTE format('
          DROP TRIGGER IF EXISTS audit_trigger ON %I.%I;
        ', target_schema, target_table);
        -- we keep the log table for historical records
      END;
      $$;
    SQL

    # ============================================
    # this adds audit triggers to core tables
    # ============================================

    # user-facing data that users can modify
    execute "SELECT audit.add_audit_trigger('public', 'messages');"
    execute "SELECT audit.add_audit_trigger('public', 'conversations');"
    execute "SELECT audit.add_audit_trigger('public', 'contributions');"
    execute "SELECT audit.add_audit_trigger('public', 'notebooks');"
    execute "SELECT audit.add_audit_trigger('public', 'notes');"
    execute "SELECT audit.add_audit_trigger('public', 'documents');"

    # configuration and membership data
    execute "SELECT audit.add_audit_trigger('public', 'hubs');"
    execute "SELECT audit.add_audit_trigger('public', 'hub_memberships');"
    execute "SELECT audit.add_audit_trigger('public', 'sources');"
    execute "SELECT audit.add_audit_trigger('public', 'messaging_integrations');"

    # user management and reports (excluding password fields - those are hashed anyway)
    execute "SELECT audit.add_audit_trigger('public', 'users');"
    execute "SELECT audit.add_audit_trigger('public', 'message_reports');"
  end

  def down
    # remove triggers (keeps log tables for historical data)
    %w[
      messages conversations contributions notebooks notes documents
      hubs hub_memberships sources messaging_integrations users message_reports
    ].each do |table|
      execute "SELECT audit.remove_audit_trigger('public', '#{table}');"
    end

    # drops helper functions
    execute "DROP FUNCTION IF EXISTS audit.remove_audit_trigger(text, text);"
    execute "DROP FUNCTION IF EXISTS audit.add_audit_trigger(text, text);"
    execute "DROP FUNCTION IF EXISTS audit.on_change_trigger_func();"
    execute "DROP FUNCTION IF EXISTS audit.create_log_table(text, text);"

    # optionally drop audit schema and all tables (commented out for safety)
    # a complete rollback would be (never!):
    # execute "DROP SCHEMA IF EXISTS audit CASCADE;"
  end
end
