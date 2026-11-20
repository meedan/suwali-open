require_relative "../unit_spec_helper"
require_relative "../../app/services/log_service"

class TestLogger
  def self.warn(_message)
  end

  def self.error(_message)
  end

  def self.info(_message)
  end
end

RSpec.describe LogService do
  it "logs information" do
    expect(TestLogger).to receive(:info)
    LogService.log(:info, "Test", "Test", TestLogger)
  end

  it "reports to Sentry when logging an error" do
    sentry = class_double("Sentry").as_stubbed_const
    allow(sentry).to receive(:get_current_scope).and_return(nil)
    expect(sentry).to receive(:capture_exception).with(instance_of(LogService::Error), extra: {message: "Test", context: "Test"})
    LogService.log(:error, "Test", "Test", TestLogger)
  end

  it "does not report to Sentry for non-error levels" do
    sentry = class_double("Sentry").as_stubbed_const
    allow(sentry).to receive(:get_current_scope).and_return(nil)
    expect(sentry).not_to receive(:capture_exception)
    LogService.log(:warn, "Test", "Test", TestLogger)
  end
end
