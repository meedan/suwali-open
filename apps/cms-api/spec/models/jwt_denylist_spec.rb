require "rails_helper"

RSpec.describe JwtDenylist, type: :model do
  describe ".jwt_revoked?" do
    let(:user) { create(:user) }

    it "returns false for a non-revoked token" do
      payload = {"jti" => "some-jti", "iat" => Time.current.to_i}
      expect(described_class.jwt_revoked?(payload, user)).to be false
    end

    it "returns true for a deny-listed JTI" do
      JwtDenylist.create!(jti: "revoked-jti", exp: 1.day.from_now)
      payload = {"jti" => "revoked-jti", "iat" => Time.current.to_i}
      expect(described_class.jwt_revoked?(payload, user)).to be true
    end

    it "returns true for a token issued before password change" do
      old_iat = 1.hour.ago.to_i
      user.update!(password_changed_at: Time.current)
      payload = {"jti" => "some-jti", "iat" => old_iat}
      expect(described_class.jwt_revoked?(payload, user)).to be true
    end

    it "returns false when password_changed_at is nil" do
      payload = {"jti" => "some-jti", "iat" => 1.hour.ago.to_i}
      expect(described_class.jwt_revoked?(payload, user)).to be false
    end
  end
end
