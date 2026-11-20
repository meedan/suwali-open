# RAILS_ENV=production bundle exec rake report_duplicate_external_users
#
# Reports only. To remediate, re-add the number through the UI: that promotes the record the
# end-user actually messages from. Output contains phone numbers.
desc "Reports WhatsApp end-users stored more than once under different spellings of the same number"
task report_duplicate_external_users: :environment do
  groups = 0

  Hub.find_each do |hub|
    PhoneIdentity::MATCHED_PLATFORMS.each do |platform|
      users = hub.external_users.where(platform: platform).order(:id).to_a
      by_external_id = users.index_by(&:external_id)
      reported = Set.new

      users.each do |user|
        next if reported.include?(user.id)
        group = PhoneIdentity.variants(user.external_id, platform).filter_map { |variant| by_external_id[variant] }
        next if group.size < 2

        group.each { |member| reported << member.id }
        groups += 1
        puts "\nHub ##{hub.id} (#{hub.name}) — #{platform}"
        group.each do |member|
          puts format("  #%-8d %-20s trusted=%-5s messages=%-5d last_message_at=%s",
            member.id, member.external_id, member.trusted_user, member.messages_count, member.last_message_at)
        end
      end
    end
  end

  puts groups.zero? ? "\nNo duplicates found." : "\nFound #{groups} end-user(s) stored under more than one number."
end
