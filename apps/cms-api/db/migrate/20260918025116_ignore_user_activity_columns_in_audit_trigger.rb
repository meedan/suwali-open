class IgnoreUserActivityColumnsInAuditTrigger < ActiveRecord::Migration[7.1]
  # The trigger logs a full old+new copy of the row on every UPDATE, and
  # last_active_at is written far more often than every real user change
  # combined. This replaces the shared function created by
  # CreateAuditLoggingInfrastructure, so re-running that migration reverts it.
  def up
    execute <<~SQL
      CREATE OR REPLACE FUNCTION audit.on_change_trigger_func() RETURNS trigger
        LANGUAGE plpgsql
        AS $_$
        DECLARE
          log_table_name text := TG_TABLE_NAME || '_log';
          v_old_data jsonb;
          v_new_data jsonb;
          v_ignored constant text[] := ARRAY['last_login_at', 'last_active_at'];
        BEGIN
          -- capture old/new data if we changed/deleted it, otherwise just record new
          IF TG_OP IN ('UPDATE', 'DELETE') THEN
            v_old_data := to_jsonb(OLD);
          END IF;

          IF TG_OP IN ('INSERT', 'UPDATE') THEN
            v_new_data := to_jsonb(NEW);
          END IF;

          -- Scoped to users: the columns exist nowhere else, and jsonb - text[]
          -- copies the whole row, which is not worth paying for on every write
          -- to messages or conversations. Nested so the cheap checks come first.
          IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'users' THEN
            -- skip only updates that changed an ignored column and nothing else.
            -- v_old_data <> v_new_data keeps an update that changed nothing at
            -- all logged exactly as before.
            IF v_old_data <> v_new_data
               AND (v_old_data - v_ignored) = (v_new_data - v_ignored) THEN
              RETURN NEW;
            END IF;
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
        $_$;
    SQL
  end

  def down
    execute <<~SQL
      CREATE OR REPLACE FUNCTION audit.on_change_trigger_func() RETURNS trigger
        LANGUAGE plpgsql
        AS $_$
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
        $_$;
    SQL
  end
end
