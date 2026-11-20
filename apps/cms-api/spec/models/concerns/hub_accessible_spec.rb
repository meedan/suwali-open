require "rails_helper"

RSpec.describe HubAccessible do
  describe ".accessible_by" do
    it "returns all records for super-admins regardless of hub membership" do
      hub = create(:hub)
      source = create(:source, hub: hub)
      super_admin = create(:user, email: "admin@meedan.com")

      expect(Source.accessible_by(super_admin)).to include(source)
    end
  end
end
