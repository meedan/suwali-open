class HubLifecycleService
  # A hub deleted while still on a free plan, distinct from one that converted to paid before being
  # removed (or is still active/trialing). Read from the audit log's old_data (final row state)
  # rather than the app-level assumption that every hard-delete path only ever touches free hubs —
  # that's true of every deletion path today (AdminController#destroy_hub and the expired-trial
  # worker both refuse a non-free hub), but a hub removed out-of-band while still paid should still
  # be correctly excluded here rather than silently miscounted.
  FREE_PLAN_LABELS = %w[free free_unrestricted].freeze

  def total_hub_count
    all_known_hub_ids.size
  end

  def churned_hub_count
    churned_rows.size
  end

  def churned_hubs
    rows = churned_rows.sort_by { |row| row[:deleted_at] }.reverse
    names = organization_names_for(rows)
    rows.map { |row| hub_row(row, names) }
  end

  def creation_dates
    {
      active: Hub.pluck(:created_at),
      deleted: deleted_rows.map { |row| row[:created_at] }
    }
  end

  def deleted_hub_summary(hub_id)
    row = deleted_rows.find { |r| r[:hub_id] == hub_id }
    row && hub_row(row, organization_names_for([row]))
  end

  private

  def churned_rows
    deleted_rows.select { |row| FREE_PLAN_LABELS.include?(row[:plan]) }
  end

  # Every hub ever known to exist: created_hub_ids covers the normal case, live_hub_ids backstops a
  # pre-audit-era hub that's still around (no INSERT row to find), and deleted_rows' hub_ids
  # backstops a pre-audit-era hub that was deleted after the audit system went live (a DELETE row
  # with no matching INSERT row).
  def all_known_hub_ids
    (created_hub_ids | live_hub_ids | deleted_rows.map { |row| row[:hub_id] }).uniq
  end

  def created_hub_ids
    ActiveRecord::Base.connection.execute(
      "SELECT DISTINCT (new_data->>'id')::bigint AS hub_id FROM audit.hubs_log WHERE operation = 'INSERT'"
    ).map { |row| row["hub_id"].to_i }
  end

  def live_hub_ids
    Hub.pluck(:id)
  end

  # old_data holds the row's final state at the moment of deletion — the column is a plain integer
  # in Postgres (the enum mapping is Rails-side only), so the raw plan value is translated back
  # through Hub.plans rather than compared as a string.
  def deleted_rows
    @deleted_rows ||= ActiveRecord::Base.connection.execute(
      "SELECT (old_data->>'id')::bigint AS hub_id, old_data->>'name' AS name,
              (old_data->>'organization_id')::bigint AS organization_id,
              (old_data->>'plan')::int AS plan_int,
              (old_data->>'created_at')::timestamp AS created_at,
              log_timestamp AS deleted_at
       FROM audit.hubs_log WHERE operation = 'DELETE'"
    ).map do |row|
      {
        hub_id: row["hub_id"].to_i,
        name: row["name"],
        organization_id: row["organization_id"]&.to_i,
        plan: Hub.plans.key(row["plan_int"].to_i),
        created_at: row["created_at"],
        deleted_at: row["deleted_at"]
      }
    end
  end

  # Organizations aren't audited and aren't deleted when a hub is, so the live table is the right
  # source for the name here — unlike the hub row itself, which is why this service exists.
  def organization_names_for(rows)
    ids = rows.map { |row| row[:organization_id] }.compact.uniq
    Organization.where(id: ids).pluck(:id, :name).to_h
  end

  def hub_row(row, organization_names)
    {
      "hub_id" => row[:hub_id],
      "hub_name" => row[:name],
      "organization_name" => organization_names[row[:organization_id]],
      "plan_at_deletion" => row[:plan],
      "created_at" => row[:created_at],
      "deleted_at" => row[:deleted_at]
    }
  end
end
