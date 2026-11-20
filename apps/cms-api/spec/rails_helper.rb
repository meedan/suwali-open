require "simplecov"
SimpleCov.start "rails" do
  add_filter "/bin/"
  add_filter "/db/"
  add_filter "/spec/"
  add_filter "/lib/tasks/"
  add_filter "/sidekiq_health.rb"

  add_group "Models", "app/models"
  add_group "Controllers", "app/controllers"
  add_group "Services", "app/services"
end

ENV["RAILS_ENV"] ||= "test"
require File.expand_path("../config/environment", __dir__)
abort("The Rails environment is running in production mode!") if Rails.env.production?
require "rspec/rails"

# Load all support files
Dir[Rails.root.join("spec/support/**/*.rb")].sort.each { |f| require f }

# Keep the test schema up to date
begin
  ActiveRecord::Migration.maintain_test_schema!
rescue ActiveRecord::PendingMigrationError => e
  abort e.to_s.strip
end

require "sidekiq/testing"
Sidekiq::Testing.fake!

require "webmock/rspec"

require "database_cleaner/active_record"
DatabaseCleaner.allow_remote_database_url = true

RSpec.configure do |config|
  config.include AuthHelper
  config.include ClusterQuestionHelper
  config.include KnowledgeServiceJobsHelper
  config.include ActiveSupport::Testing::TimeHelpers
  # Use FactoryBot shorthand methods like `create(:user)`
  config.include FactoryBot::Syntax::Methods

  config.use_transactional_fixtures = true
  config.infer_spec_type_from_file_location!
  config.filter_rails_from_backtrace!

  Bullet.add_safelist type: :unused_eager_loading, class_name: "Message", association: :conversation
  Bullet.add_safelist type: :unused_eager_loading, class_name: "Message", association: :message_data_source_items
  # Added the safelist below, due to an ActiveStorage issue, which has been fixed on Rails 8.1.0
  Bullet.add_safelist type: :unused_eager_loading, class_name: "ActiveStorage::Attachment", association: :record

  config.before(:each) do
    Bullet.start_request
    # Stub the first message preview HTTP call globally since Rails.cache is NullStore in test,
    # causing Rails.cache.fetch to always call KnowledgeService.preview on every first incoming message.
    # Using WebMock instead of rspec stubs to avoid interfering with message expectations in other tests.
    stub_request(:post, "http://knowledge:8000/preview/")
      .with(body: hash_including("scenario" => "first_message"))
      .to_return(status: 200, body: '{"answer": "Welcome."}', headers: {"Content-Type" => "application/json"})
  end

  config.after(:each) do
    Bullet.perform_out_of_channel_notifications if Bullet.notification?
    Bullet.end_request
  end
end

# Shoulda Matchers configuration
require "shoulda/matchers"
Shoulda::Matchers.configure do |config|
  config.integrate do |with|
    with.test_framework :rspec
    with.library :rails
  end
end

SimpleCov.at_exit do
  result = SimpleCov.result
  previous_result_file = File.join(SimpleCov.coverage_path, ".last_percent")

  previous_percent = if File.exist?(previous_result_file)
    File.read(previous_result_file).to_f
  else
    0.0
  end

  if result.covered_percent != previous_percent
    puts "Coverage changed: #{previous_percent.round(2)}% → #{result.covered_percent.round(2)}%."
  else
    puts "Coverage unchanged (#{result.covered_percent.round(2)}%)."
  end
  File.write(previous_result_file, result.covered_percent)
  result.format!
end
