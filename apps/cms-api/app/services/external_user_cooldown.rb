class ExternalUserCooldown
  DURATION = 30.minutes

  def initialize(external_user)
    @external_user = external_user
  end

  def active?
    Sidekiq.redis { |conn| conn.get(key) }.present?
  end

  def start!
    return false unless Sidekiq.redis { |conn| conn.set(key, Time.now.to_i, ex: DURATION.to_i, nx: true) }

    LogService.log :warn, "ExternalUserCooldown", "Started #{DURATION.inspect} cooldown for external user #{@external_user.id}"
    true
  end

  def reset!
    Sidekiq.redis { |conn| conn.del(key) }
    true
  end

  private

  def key
    "external_user_cooldown:#{Rails.env}:#{@external_user.id}"
  end
end
