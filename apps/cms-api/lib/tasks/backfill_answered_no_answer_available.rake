# RAILS_ENV=production bundle exec rake backfill_answered_no_answer_available
# Dry run by default (prints the count only); pass apply=true to actually update (SUWALI-981).
desc "Backfills answered=false for outgoing replies with error_type NO_ANSWER_AVAILABLE that were left null"
task backfill_answered_no_answer_available: :environment do
  def log(message, level: :info)
    puts message
    LogService.log(level, "Rake Task: Backfill answered for NO_ANSWER_AVAILABLE", message)
  end

  messages_to_fix = Message
    .where(direction: "outgoing", answered: nil)
    .where("metadata->>'error_type' = ?", "NO_ANSWER_AVAILABLE")
    .where.not(reply_to_id: nil)

  count = messages_to_fix.count
  log "Found #{count} message(s) with answered IS NULL and error_type = NO_ANSWER_AVAILABLE"

  if ENV["apply"] == "true"
    updated = messages_to_fix.update_all(answered: false)
    log "Updated #{updated} message(s)."
  else
    log "Dry run only - no changes made. Re-run with apply=true to apply the fix."
  end
end
