# RAILS_ENV=production bundle exec rake backfill_first_contributions
desc "Backfills first_time_contributor on contributions and first_contribution_at on external users"
task backfill_first_contributions: :environment do
  def log(message)
    puts message
    LogService.log(:info, "Rake Task: Backfill first contributions", message)
  end

  started = Time.now
  log "[#{Time.now}] Backfilling first contributions..."

  # Set-based rather than row-by-row: deciding which contribution came first is a comparison
  # between rows, so doing it in Ruby would mean loading a hub's whole history to answer it.
  # Restricted to end-users, matching Contribution#claim_first_contribution — an internal
  # participant has no contributor history, so its contributions are never first-time.
  contributions = ActiveRecord::Base.connection.update(<<~SQL.squish)
    UPDATE contributions SET first_time_contributor = TRUE WHERE id IN (
      SELECT DISTINCT ON (conversations.participant_id) contributions.id
      FROM contributions
      JOIN messages ON messages.id = contributions.message_id
      JOIN conversations ON conversations.id = messages.conversation_id
      WHERE conversations.participant_type = 'ExternalUser'
      ORDER BY conversations.participant_id, contributions.created_at, contributions.id
    )
  SQL

  external_users = ActiveRecord::Base.connection.update(<<~SQL.squish)
    UPDATE external_users SET first_contribution_at = firsts.first_at
    FROM (
      SELECT conversations.participant_id AS external_user_id,
             MIN(contributions.created_at) AS first_at
      FROM contributions
      JOIN messages ON messages.id = contributions.message_id
      JOIN conversations ON conversations.id = messages.conversation_id
      WHERE conversations.participant_type = 'ExternalUser'
      GROUP BY conversations.participant_id
    ) AS firsts
    WHERE external_users.id = firsts.external_user_id
  SQL

  elapsed = Time.now - started
  log "[#{Time.now}] Done in #{(elapsed / 60).to_i}m #{(elapsed % 60).to_i}s"
  log "Marked as first-time: #{contributions} contributions"
  log "Dated: #{external_users} external users"
end
