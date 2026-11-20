# Devise's lockable hook resets failed_attempts on every :authentication event
# (devise/hooks/lockable.rb). Under JWT that is every request, so the counter never
# reaches maximum_attempts. Drop the hook; User#after_database_authentication resets
# it after a real password login instead.
require "devise/models/lockable"

removed = Warden::Manager._after_set_user.reject! do |callback, _options|
  callback.source_location&.first&.end_with?("devise/hooks/lockable.rb")
end

raise "Devise lockable reset hook not found - check devise version" if removed.nil?
