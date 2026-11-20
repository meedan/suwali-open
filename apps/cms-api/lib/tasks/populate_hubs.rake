# Populates a freshly seeded local database with realistic hub data.
#   bundle exec rake populate_hubs
require Rails.root.join("db/seeds/topic_subscription_seeder")

desc "Run every local data step in order: conversations, topic subscriptions, top questions"
task populate_hubs: ["populate_hubs:conversations", "populate_hubs:topic_subscriptions", "top_questions:backfill"]

namespace :populate_hubs do
  desc "Import the committed conversation snapshot into each hub that has one"
  task conversations: :environment do
    abort "[populate_hubs] Not available in production." if ENV["DEPLOY_ENV"] == "prod"

    hubs = Dir[Rails.root.join("db/seeds/data/*/enduser_conversation_snapshot/enduser_conversation_snapshot.yml")].sort.map do |path|
      hub_dir = Pathname.new(path).parent.parent.basename.to_s
      [YAML.load_file(Rails.root.join("db/seeds/data/#{hub_dir}/hub.yml"))["name"], hub_dir]
    end

    hubs.each do |hub_name, hub_dir|
      # Rake runs a task once per process; without this the second hub silently no-ops.
      Rake::Task["enduser_conversation_snapshot:import"].reenable
      Rake::Task["enduser_conversation_snapshot:import"].invoke(hub_name, hub_dir)
    end
  end

  # Subscriptions never leave the source environment, so they are made up locally after the import.
  desc "Subscribe seeded end users to topics, so the hub dashboard has an audience to report on"
  task topic_subscriptions: :environment do
    abort "[populate_hubs] Not available in production." if ENV["DEPLOY_ENV"] == "prod"

    seeded = Hub.all.to_h { |hub| [hub.name, TopicSubscriptionSeeder.new(hub).seed!] }
    LogService.log(:info, "populate_hubs", "Done. #{seeded.map { |name, count| "#{name}: #{count}" }.join(", ")}")
  end
end
