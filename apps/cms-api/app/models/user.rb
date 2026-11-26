class User < ApplicationRecord
  # Include default devise modules. Others available are:
  # :confirmable, :lockable, :timeoutable, :trackable and :omniauthable
  #
  # :trackable is not used on purpose: it would also store sign-in IP addresses.
  devise :database_authenticatable, :registerable,
    :recoverable, :rememberable, :validatable, :confirmable,
    :lockable, :jwt_authenticatable, jwt_revocation_strategy: JwtDenylist

  ACTIVITY_THROTTLE = 15.minutes
  INACTIVITY_THRESHOLD = 30.days

  # Falls back to created_at so a user who just signed up is not already
  # inactive. Defined once: filtering and ordering have to agree, and anything
  # indexing this later has to match it exactly.
  LAST_SEEN_AT = "COALESCE(users.last_active_at, users.created_at)"

  has_many :hub_memberships, dependent: :destroy
  has_many :hubs, through: :hub_memberships
  has_many :notebooks, dependent: :destroy
  has_many :notes, dependent: :destroy
  has_many :conversations, as: :participant, dependent: :destroy
  has_many :message_reports, foreign_key: :reported_by_id, dependent: :destroy
  has_many :bulk_conversation_exports, foreign_key: :requested_by_id, dependent: :destroy

  validates :email, presence: true
  validates :name, length: {maximum: 100}
  validate :password_complexity

  has_one_attached :profile_picture

  before_update :track_password_change, if: :will_save_change_to_encrypted_password?

  scope :inactive, ->(since = INACTIVITY_THRESHOLD.ago) { where("#{LAST_SEEN_AT} < ?", since) }
  scope :least_recently_seen_first, -> { order(Arel.sql("#{LAST_SEEN_AT} ASC")) }
  scope :super_admins, -> { where.not(confirmed_at: nil).where.not("email LIKE '%@%@%'").where("lower(split_part(email, '@', 2)) IN (?)", super_admin_email_domains) }

  # Public domains are ignored; otherwise anyone could sign up with one and read every hub.
  def self.super_admin_email_domains
    ENV.fetch("SUPER_ADMIN_EMAIL_DOMAINS", "").split(",").map { |d| d.strip.downcase }
      .reject { |d| d.empty? || PUBLIC_EMAIL_DOMAINS_LIST.include?(d) }
  end

  # update_columns: these run on ordinary requests and must not fire validations
  # or touch updated_at.
  def track_login!
    now = Time.current
    update_columns(last_login_at: now, last_active_at: now)
  end

  def track_activity!
    update_columns(last_active_at: Time.current)
  end

  def activity_stale?
    last_active_at.nil? || last_active_at < ACTIVITY_THROTTLE.ago
  end

  def profile_picture_url
    profile_picture.attached? ? Rails.application.routes.url_helpers.rails_storage_proxy_url(profile_picture, host: ENV.fetch("CMS_API_EXTERNAL_URL", "http://localhost:3000")) : nil
  end

  # Read-only super admin: any confirmed user whose email domain is in SUPER_ADMIN_EMAIL_DOMAINS
  def is_admin
    confirmed? && email.to_s.count("@") == 1 && User.super_admin_email_domains.include?(email_domain) || false
  end

  def is_write_admin
    is_admin && admin_write_access?
  end

  def email_domain
    email.to_s.split("@").last.to_s.downcase
  end

  def is_public_email_domain?
    PUBLIC_EMAIL_DOMAINS_LIST.include?(email_domain)
  end

  def joinable_hubs
    return Hub.none if is_public_email_domain?

    Hub.joins(hub_memberships: :user)
      .where(deletion_in_progress: false)
      .where(hub_memberships: {role: HubMembership.roles[:admin], approved: true})
      .where("LOWER(SPLIT_PART(users.email, '@', 2)) = ?", email_domain)
      .where.not(id: hub_ids)
      .distinct
      .order("created_at ASC")
      .limit(5)
  end

  # Devise's global hook that did this on every authentication is removed in
  # config/initializers/devise_lockable.rb; it fired on every JWT request.
  def after_database_authentication
    reset_failed_attempts!
  end

  def can_access_hub?(hub)
    is_admin || hub_memberships.approved.exists?(hub: hub)
  end

  def as_json(options = {})
    user = {
      id: id,
      name: name,
      email: email,
      confirmed: confirmed?,
      profile_picture_url: profile_picture_url,
      is_public_email_domain: is_public_email_domain?,
      is_admin: is_admin,
      is_write_admin: is_write_admin
    }
    if options[:include_activity]
      user[:last_login_at] = last_login_at&.iso8601
      user[:last_active_at] = last_active_at&.iso8601
    end
    if options[:include_hubs]
      user[:hubs] = hub_memberships.approved.map(&:hub).as_json(include_hub_membership_for_user_id: id)
      user[:pending_hubs] = hub_memberships.pending_approval.collect { |hm| hm.hub.as_json(include_hub_membership_for_user_id: id).slice(:id, :name, :hub_membership) }
    end
    user
  end

  private

  def track_password_change
    self.password_changed_at = Time.current
  end

  def password_complexity
    return unless password.present?
    errors.add(:base, I18n.t(:error_password_strength)) unless /\A(?=[\s\S]*[A-Za-z])(?=[\s\S]*\d)(?=[\s\S]*[^A-Za-z0-9])[\s\S]{8,}\z/.match?(password)
  end
end
