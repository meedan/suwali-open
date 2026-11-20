require "rails_helper"

RSpec.describe ExternalUserCooldown, type: :service do
  let(:external_user) { create(:external_user) }
  let(:cooldown) { described_class.new(external_user) }

  after { cooldown.reset! }

  it "is not active by default" do
    expect(cooldown.active?).to be(false)
  end

  it "records a cooldown" do
    expect { cooldown.start! }.to change { cooldown.active? }.from(false).to(true)
  end

  it "expires on its own" do
    cooldown.start!

    ttl = Sidekiq.redis { |conn| conn.call("TTL", "external_user_cooldown:#{Rails.env}:#{external_user.id}") }
    expect(ttl).to be > 0
    expect(ttl).to be <= described_class::DURATION.to_i
  end

  it "does not extend a cooldown already in flight" do
    cooldown.start!

    expect(cooldown.start!).to be(false)
  end

  it "can be lifted manually" do
    cooldown.start!

    expect { cooldown.reset! }.to change { cooldown.active? }.from(true).to(false)
  end
end
