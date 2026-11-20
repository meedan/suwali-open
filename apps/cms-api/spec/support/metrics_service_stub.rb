RSpec.configure do |config|
  config.before(:each) do
    allow_any_instance_of(MetricsService).to receive(:measure).and_yield
    allow_any_instance_of(MetricsService).to receive(:publish_metric)
  end
end
