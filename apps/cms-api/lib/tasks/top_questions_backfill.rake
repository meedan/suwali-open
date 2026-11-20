# Run all top questions backfill tasks in order:
#   RAILS_ENV=production bundle exec rake top_questions:backfill
#
# Or run each pipeline independently:
#   RAILS_ENV=production bundle exec rake top_questions:cluster
#   RAILS_ENV=production bundle exec rake top_questions:answered

namespace :top_questions do
  desc "Backfill embeddings and cluster assignments for incoming messages"
  task cluster: :environment do
    ENV["apply"] = "true"
    Rake::Task["update_messages_embedding:add_embedding_to_messages"].invoke
    Rake::Task["assign_clusters_to_messages"].invoke
    Rake::Task["backfill_centroid_message_id"].invoke
  end

  desc "Backfill reply associations and answered status on bot messages"
  task answered: [
    :assign_reply_to_messages,
    :backfill_answered_on_messages
  ]

  desc "Run the full top questions backfill (cluster + answered) in the correct order"
  task backfill: [:cluster, :answered]
end
