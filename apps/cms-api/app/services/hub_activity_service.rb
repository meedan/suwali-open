class HubActivityService
  # A chronological, curated timeline for one hub — key lifecycle signals scoped to a single hub
  # and returned as discrete events. Deliberately not a raw audit-log dump: most field-level changes
  # (message content, contribution edits, etc.) are noise for "what happened to this hub."
  #
  # Every query against an audit.*_log table caps at MAX_ROWS_PER_QUERY, ordered newest-first, so a
  # single hub with an unusually long history can't return an unbounded result set.
  MAX_ROWS_PER_QUERY = 1000

  def initialize(hub_id)
    @hub_id = hub_id
  end

  def timeline
    events = hub_created_events + hub_deleted_events + plan_changed_events + deletion_requested_events +
      membership_events + source_events + document_first_synced_events + messaging_events +
      trial_dates_changed_events + custom_limits_events + feature_flag_events + trial_emails_toggled_events
    emails = emails_by_user_id(events.flat_map { |event| event.values_at("actor_id", "member_id") }.compact.uniq)
    events.each do |event|
      event["actor_email"] = emails[event.delete("actor_id")]
      event["detail"] = emails[event.delete("member_id")] if event.key?("member_id")
    end
    events.sort_by { |event| event["at"] }.reverse
  end

  private

  attr_reader :hub_id

  # Every audit.*_log row already carries who made the change, in log_user_id (set from the
  # request's audit.current_user_id session var) — nullable for background jobs, console use, and
  # rows predating the audit system.
  def with_actor(rows, type:, detail_key: nil)
    rows.map do |row|
      {
        "type" => type,
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => detail_key ? row[detail_key] : nil
      }
    end
  end

  def emails_by_user_id(user_ids)
    ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT DISTINCT ON (new_data->>'id') new_data->>'id' AS user_id, new_data->>'email' AS email
         FROM audit.users_log WHERE operation = 'INSERT' AND new_data->>'id' IN (?)
         ORDER BY new_data->>'id', log_timestamp DESC",
        user_ids.map(&:to_s)
      ])
    ).each_with_object({}) { |row, hash| hash[row["user_id"].to_i] = row["email"] }
  end

  def hub_created_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'created_at')::timestamp AS at, log_user_id
         FROM audit.hubs_log
         WHERE operation = 'INSERT' AND new_data->>'id' = ?
         ORDER BY (new_data->>'created_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    with_actor(rows, type: "hub_created")
  end

  # The hard-delete itself, distinct from deletion_requested_events below (which marks the earlier,
  # reversible "flagged for deletion" step). No other timestamp exists for a DELETE row, so this
  # keeps log_timestamp — same as membership_removed, source_removed, etc.
  def hub_deleted_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT log_timestamp AS at, log_user_id
         FROM audit.hubs_log
         WHERE operation = 'DELETE' AND old_data->>'id' = ?
         ORDER BY log_timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    with_actor(rows, type: "hub_deleted")
  end

  def plan_changed_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id, old_data->>'plan' AS old_plan, new_data->>'plan' AS new_plan
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND old_data->>'plan' IS DISTINCT FROM new_data->>'plan'
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    rows.map do |row|
      old_plan = Hub.plans.key(row["old_plan"].to_i)
      new_plan = Hub.plans.key(row["new_plan"].to_i)
      {
        "type" => "plan_changed",
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => "#{old_plan} → #{new_plan}",
        "old_plan" => old_plan,
        "new_plan" => new_plan
      }
    end
  end

  def deletion_requested_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND old_data->>'deletion_requested_at' IS NULL AND new_data->>'deletion_requested_at' IS NOT NULL
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    with_actor(rows, type: "deletion_requested")
  end

  # INSERT events use the row's own created_at as "at", not the audit row's log_timestamp: the two
  # coincide for a normal live write, but diverge for backdated data (e.g. seeded/synthetic hubs),
  # and created_at is what the rest of the admin UI already treats as ground truth. DELETE events
  # have no such column, so those keep log_timestamp — see membership_rows_to_events etc. below.
  def membership_events
    added = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'created_at')::timestamp AS at, log_user_id, new_data->>'user_id' AS user_id
         FROM audit.hub_memberships_log
         WHERE operation = 'INSERT' AND new_data->>'hub_id' = ?
         ORDER BY (new_data->>'created_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    removed = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT log_timestamp AS at, log_user_id, old_data->>'user_id' AS user_id
         FROM audit.hub_memberships_log
         WHERE operation = 'DELETE' AND old_data->>'hub_id' = ?
         ORDER BY log_timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    membership_rows_to_events(added, "membership_added") + membership_rows_to_events(removed, "membership_removed")
  end

  def membership_rows_to_events(rows, type)
    rows.map do |row|
      {
        "type" => type,
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "member_id" => row["user_id"].to_i
      }
    end
  end

  def source_events
    added = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'created_at')::timestamp AS at, log_user_id, new_data->>'name' AS name, (new_data->>'source_type')::int AS source_type
         FROM audit.sources_log
         WHERE operation = 'INSERT' AND new_data->>'hub_id' = ?
         AND COALESCE(new_data->>'preloaded', 'false') = 'false'
         ORDER BY (new_data->>'created_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    removed = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT log_timestamp AS at, log_user_id, old_data->>'name' AS name, (old_data->>'source_type')::int AS source_type
         FROM audit.sources_log
         WHERE operation = 'DELETE' AND old_data->>'hub_id' = ?
         AND COALESCE(old_data->>'preloaded', 'false') = 'false'
         ORDER BY log_timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    source_rows_to_events(added, "source_added") + source_rows_to_events(removed, "source_removed")
  end

  def source_rows_to_events(rows, type)
    rows.map do |row|
      {
        "type" => type,
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => [row["name"], Source.source_types.key(row["source_type"])].compact.join(" – ")
      }
    end
  end

  # Mirrors Hub#compute_own_document_ever_synced: reads hub_id from the source's own INSERT row
  # (documents_log itself only carries source_id), and only the first sync — a per-document entry
  # would be unbounded noise for an active hub, while "first sync" is the meaningful milestone.
  #
  # Resolved as two queries rather than one join: neither audit table is indexed on the jsonb keys
  # involved, so joining them makes Postgres re-scan all of documents_log once per source. Looking
  # the source ids up first keeps it to a single scan of each table.
  def document_first_synced_events
    source_ids = hub_source_ids
    return [] if source_ids.empty?

    at = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT MIN((new_data->>'updated_at')::timestamp) AS at
         FROM audit.documents_log
         WHERE operation IN ('INSERT', 'UPDATE')
         AND new_data->>'sync_status' = ?
         AND new_data->>'source_id' IN (?)",
        Document.sync_statuses[:complete].to_s, source_ids
      ])
    ).first["at"]

    return [] if at.nil?
    [{"type" => "document_first_synced", "at" => at, "actor_email" => nil, "detail" => nil}]
  end

  # Compared as text, like every other id filter in this service — to_jsonb renders a bigint as a
  # plain JSON number, so ->> gives canonical digits. Casting to bigint here would also stop an
  # expression index on this column from ever being used.
  def hub_source_ids
    @hub_source_ids ||= ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT DISTINCT new_data->>'id' AS id
         FROM audit.sources_log
         WHERE operation = 'INSERT' AND new_data->>'hub_id' = ?
         AND COALESCE(new_data->>'preloaded', 'false') = 'false'",
        hub_id.to_s
      ])
    ).map { |row| row["id"] }
  end

  def messaging_events
    added = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'created_at')::timestamp AS at, log_user_id, new_data->>'type' AS platform
         FROM audit.messaging_integrations_log
         WHERE operation = 'INSERT' AND new_data->>'hub_id' = ?
         ORDER BY (new_data->>'created_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    removed = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT log_timestamp AS at, log_user_id, old_data->>'type' AS platform
         FROM audit.messaging_integrations_log
         WHERE operation = 'DELETE' AND old_data->>'hub_id' = ?
         ORDER BY log_timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    messaging_rows_to_events(added, "messaging_connected") + messaging_rows_to_events(removed, "messaging_disconnected")
  end

  def messaging_rows_to_events(rows, type)
    rows.map do |row|
      {
        "type" => type,
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => row["platform"]
      }
    end
  end

  # trial_started_at and trial_ends_at are both editable from the same admin form, and often change
  # together — one event per UPDATE row, describing whichever of the two actually changed, rather
  # than two separately-timestamped events for what was a single edit.
  def trial_dates_changed_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id,
                old_data->>'trial_started_at' AS old_start, new_data->>'trial_started_at' AS new_start,
                old_data->>'trial_ends_at' AS old_end, new_data->>'trial_ends_at' AS new_end
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND (old_data->>'trial_started_at' IS DISTINCT FROM new_data->>'trial_started_at'
           OR old_data->>'trial_ends_at' IS DISTINCT FROM new_data->>'trial_ends_at')
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    rows.map do |row|
      parts = []
      if row["old_start"] != row["new_start"]
        parts << "Start: #{format_audit_date(row["old_start"])} → #{format_audit_date(row["new_start"])}"
      end
      if row["old_end"] != row["new_end"]
        parts << "End: #{format_audit_date(row["old_end"])} → #{format_audit_date(row["new_end"])}"
      end
      {
        "type" => "trial_dates_changed",
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => parts.join(", ")
      }
    end
  end

  def format_audit_date(value)
    value.nil? ? "none" : value[0, 10]
  end

  def custom_limits_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id,
                old_data->'custom_limits' AS old_json, new_data->'custom_limits' AS new_json
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND old_data->'custom_limits' IS DISTINCT FROM new_data->'custom_limits'
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    jsonb_diff_events(rows, "custom_limits_changed")
  end

  def feature_flag_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id,
                old_data->'allowed_features' AS old_json, new_data->'allowed_features' AS new_json
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND old_data->'allowed_features' IS DISTINCT FROM new_data->'allowed_features'
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    jsonb_diff_events(rows, "feature_flag_changed")
  end

  # Both custom_limits and allowed_features are small flat jsonb hashes (limit/feature name -> value),
  # so a per-key diff is more useful here than dumping the whole before/after blob — one event per
  # key that actually changed within a single UPDATE row.
  def jsonb_diff_events(rows, type)
    rows.flat_map do |row|
      old_hash = parse_jsonb_hash(row["old_json"])
      new_hash = parse_jsonb_hash(row["new_json"])
      changed_keys = (old_hash.keys | new_hash.keys).select { |key| old_hash[key] != new_hash[key] }
      changed_keys.map do |key|
        {
          "type" => type,
          "at" => row["at"],
          "actor_id" => row["log_user_id"].to_i,
          "detail" => "#{key}: #{old_hash[key].inspect} → #{new_hash[key].inspect}"
        }
      end
    end
  end

  # custom_limits is nullable, and to_jsonb(OLD) encodes a NULL column as JSON null — so the value
  # arrives here as the string "null", which is truthy and which JSON.parse decodes to nil. Every
  # hub's first custom-limit edit goes through that transition.
  def parse_jsonb_hash(value)
    parsed = value.nil? ? nil : JSON.parse(value)
    parsed.is_a?(Hash) ? parsed : {}
  end

  def trial_emails_toggled_events
    rows = ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql([
        "SELECT (new_data->>'updated_at')::timestamp AS at, log_user_id, new_data->>'trial_emails_enabled' AS new_value
         FROM audit.hubs_log
         WHERE operation = 'UPDATE' AND new_data->>'id' = ?
         AND old_data->>'trial_emails_enabled' IS DISTINCT FROM new_data->>'trial_emails_enabled'
         ORDER BY (new_data->>'updated_at')::timestamp DESC
         LIMIT ?",
        hub_id.to_s, MAX_ROWS_PER_QUERY
      ])
    )
    rows.map do |row|
      {
        "type" => "trial_emails_toggled",
        "at" => row["at"],
        "actor_id" => row["log_user_id"].to_i,
        "detail" => (row["new_value"] == "true") ? "Enabled" : "Disabled"
      }
    end
  end
end
