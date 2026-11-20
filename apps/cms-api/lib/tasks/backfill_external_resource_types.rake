# RAILS_ENV=production bundle exec rake backfill_external_resource_types
#
# Sets resource_type on resources saved before the type was stored. A title that is not a link, phone number,
# or email address is left untyped and printed by hub for review. Output contains resource titles.
desc "Sets resource_type on existing external resources from what their title looks like"
task backfill_external_resource_types: :environment do
  counts = Hash.new(0)

  Hub.find_each do |hub|
    unrecognized = []

    hub.external_resources.where(resource_type: nil).order(:id).each do |resource|
      type = ExternalResource.detect_type(resource.title)

      if type
        # skips validations and callbacks: an old description over today's length limit must not block the type
        resource.update_column(:resource_type, type)
        counts[type] += 1
      else
        unrecognized << resource
      end
    end

    next if unrecognized.empty?

    counts["unrecognized"] += unrecognized.size
    puts "\nHub ##{hub.id} (#{hub.name})"
    unrecognized.each { |resource| puts format("  #%-6d %s", resource.id, resource.title) }
  end

  puts "\nSet: #{counts.except("unrecognized").map { |type, count| "#{count} #{type}" }.join(", ").presence || "none"}"
  puts "Left untyped for review: #{counts["unrecognized"]}"
end
