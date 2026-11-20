require "rails_helper"

RSpec.describe JwtDenylistCleanupWorker do
  it "removes expired entries from the deny list" do
    JwtDenylist.create!(jti: "expired-jti", exp: 2.days.ago)
    JwtDenylist.create!(jti: "valid-jti", exp: 1.day.from_now)

    described_class.new.perform

    expect(JwtDenylist.count).to eq(1)
    expect(JwtDenylist.first.jti).to eq("valid-jti")
  end

  it "handles an empty deny list" do
    expect { described_class.new.perform }.not_to raise_error
  end
end
