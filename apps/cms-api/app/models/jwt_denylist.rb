class JwtDenylist < ApplicationRecord
  include Devise::JWT::RevocationStrategies::Denylist

  self.table_name = "jwt_denylist"

  def self.jwt_revoked?(payload, user)
    return true if exists?(jti: payload["jti"])

    if user.password_changed_at.present? && payload["iat"].present?
      token_issued_at = Time.at(payload["iat"]).utc
      return true if token_issued_at < user.password_changed_at
    end

    false
  end
end
