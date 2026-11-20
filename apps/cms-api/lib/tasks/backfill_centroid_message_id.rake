# RAILS_ENV=production bundle exec rake backfill_centroid_message_id
desc "Backfill centroid_message_id for existing message clusters"
task backfill_centroid_message_id: :environment do
  def log(message)
    puts message
    LogService.log(:info, "Rake Task: Backfill centroid_message_id", message)
  end

  started = Time.now
  updated_count = 0
  skipped_count = 0

  clusters = MessageCluster.where(centroid_message_id: nil)
  total_count = clusters.count

  log "[#{Time.now}] Backfilling centroid_message_id for #{total_count} clusters..."

  clusters.find_each do |cluster|
    message = cluster.messages.first

    if message.nil?
      skipped_count += 1
      next
    end

    cluster.update_columns(centroid_message_id: message.id)
    updated_count += 1
    print "."
  end

  elapsed = Time.now - started
  minutes = (elapsed / 60).to_i
  seconds = (elapsed % 60).to_i

  log "\n[#{Time.now}] Done in #{minutes}m #{seconds}s"
  log "Successfully updated: #{updated_count} clusters"
  log "Skipped (no messages): #{skipped_count} clusters" if skipped_count > 0
end
