require_relative "../unit_spec_helper"
require_relative "../../app/lib/app_info"

RSpec.describe AppInfo do
  it "defines name" do
    expect(AppInfo.const_defined?(:NAME)).to be true
  end

  describe ".schedule_demo_link" do
    it "is the configured link" do
      allow(ENV).to receive(:fetch).with("SCHEDULE_DEMO_LINK", anything).and_return("https://example.com/demo")
      expect(AppInfo.schedule_demo_link).to eq("https://example.com/demo")
    end

    it "falls back to the Suwali demo page" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("SCHEDULE_DEMO_LINK", anything) { |_key, default| default }
      expect(AppInfo.schedule_demo_link).to eq("https://suwali.io/demo")
    end
  end
end
