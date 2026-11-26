# When running in the staging environment
# RAILS_ENV=production bundle exec rake enduser_conversation_snapshot:export[HubName,HubDir]
# RAILS_ENV=production bundle exec rake enduser_conversation_snapshot:import[HubName,HubDir]
require Rails.root.join("db/seeds/enduser_conversation_masker")
require Rails.root.join("db/seeds/enduser_conversation_timeshifter")
require Rails.root.join("db/seeds/enduser_conversation_sampler")
require Rails.root.join("db/seeds/enduser_conversation_serializer")
require Rails.root.join("db/seeds/enduser_conversation_loader")

LOG_CONTEXT = "enduser_conversation_snapshot"

namespace :enduser_conversation_snapshot do
  desc "Exports the latest partial end-user conversations snapshot to S3"
  task :export, [:hub_name, :hub_dir] => :environment do |_, args|
    abort "[enduser_conversation_snapshot] Not available in production." if ENV["DEPLOY_ENV"] == "prod"
    abort "[enduser_conversation_snapshot] hub_name argument is required" unless args[:hub_name]
    abort "[enduser_conversation_snapshot] hub_dir argument is required" unless args[:hub_dir]

    hub = Hub.find_by(name: args[:hub_name])
    abort "[enduser_conversation_snapshot] Hub '#{args[:hub_name]}' not found" unless hub
    LogService.log(:info, LOG_CONTEXT, "Hub: #{hub.name} (id=#{hub.id})")

    sampler = EnduserConversationSampler.new(hub)
    abort "[enduser_conversation_snapshot] No external users with conversations found" if sampler.external_users.empty?

    LogService.log(:info, LOG_CONTEXT, "External users: #{sampler.external_users.size}, conversations: #{sampler.conversations.size} (#{sampler.contribution_conversations.size} with contributions)")
    if sampler.contributions.empty?
      LogService.log(:warn, LOG_CONTEXT, "No contributions found for #{hub.name} — submit a few through the bot before exporting")
    end

    data = EnduserConversationSerializer.new(sampler).as_snapshot

    LogService.log(:info, LOG_CONTEXT, "Messages: #{data["messages"].size}, topics: #{data["topics"].size}, topic items: #{data["topic_items"].size}, data source items: #{data["message_data_source_items"].size}, contributions: #{data["contributions"].size}")

    snapshot = EnduserConversationMasker.new.mask(data)

    leaks = EnduserConversationMasker.leaks(snapshot)
    abort "[enduser_conversation_snapshot] Refusing to upload, these escaped masking: #{leaks.inspect}" if leaks.any?

    # Mirror config/storage.yml: explicit keys are optional, so deployed environments fall back to
    # the IAM role, and the endpoint is only set for Silo locally. Fetching the keys outright
    # fails in deployed environments, where S3 access comes from the task role rather than the environment.
    client_options = {region: ENV.fetch("S3_REGION", "eu-west-1")}
    if ENV["S3_ACCESS_KEY_ID"].present?
      client_options[:access_key_id] = ENV["S3_ACCESS_KEY_ID"]
      client_options[:secret_access_key] = ENV.fetch("S3_SECRET_ACCESS_KEY")
    end
    if ENV["S3_ENDPOINT"].present?
      client_options[:endpoint] = ENV["S3_ENDPOINT"]
      client_options[:force_path_style] = true
    end

    s3 = Aws::S3::Client.new(**client_options)

    key = "enduser_conversation_snapshots/#{args[:hub_dir]}/enduser_conversation_snapshot.yml"
    s3.put_object(bucket: ENV.fetch("S3_BUCKET"), key: key, body: snapshot.to_yaml, content_type: "application/yaml")
    LogService.log(:info, LOG_CONTEXT, "Uploaded to s3://#{ENV.fetch("S3_BUCKET")}/#{key}")
  end

  desc "Import the latest partial end-user conversations snapshot from db/seeds/data/hub_dir/enduser_conversation_snapshot into the target hub"
  task :import, [:hub_name, :hub_dir] => :environment do |_, args|
    abort "[enduser_conversation_snapshot] Not available in production." if ENV["DEPLOY_ENV"] == "prod"
    # question: should this be enabled in staging?
    abort "[enduser_conversation_snapshot] hub_name argument is required" unless args[:hub_name]
    abort "[enduser_conversation_snapshot] hub_dir argument is required" unless args[:hub_dir]

    hub = Hub.find_by(name: args[:hub_name])
    abort "[enduser_conversation_snapshot] Hub #{args[:hub_name]} not found" unless hub

    local_path = Rails.root.join("db/seeds/data/#{args[:hub_dir]}/enduser_conversation_snapshot/enduser_conversation_snapshot.yml")
    abort "[enduser_conversation_snapshot] No snapshot file found at #{local_path}" unless File.exist?(local_path)

    LogService.log(:info, LOG_CONTEXT, "Loading #{File.basename(local_path)} → hub '#{hub.name}' (id=#{hub.id})")
    data = EnduserConversationTimeshifter.new.shift(YAML.unsafe_load_file(local_path))

    written = EnduserConversationLoader.new(hub, data).load

    # The loader bypasses callbacks, so queue the work Contribution would have queued on create.
    to_ingest = hub.contributions.where(active: true, sync_status: :pending)
    to_ingest.find_each { |contribution| KnowledgeServiceWorker.perform_in(5.seconds, "ingest_community_knowledge", contribution.id) }

    # Paused contributions are never ingested, so topics come from extraction instead.
    to_extract = hub.contributions.where(active: false).where.missing(:topic_items)
    to_extract.find_each { |contribution| KnowledgeServiceWorker.perform_async("extract_community_knowledge_topics", contribution.id) }

    LogService.log(:info, LOG_CONTEXT, "Queued #{to_ingest.count} contributions for ingestion, #{to_extract.count} for topic extraction")

    # Contribution#claim_first_contribution is another callback the loader skips, and the snapshot
    # carries no flag of its own, so imported contributions would all read as returning.
    Rake::Task["backfill_first_contributions"].invoke

    LogService.log(:info, LOG_CONTEXT, "Done. #{written.map { |section, count| "#{section}: #{count}" }.join(", ")}")
  end
end
