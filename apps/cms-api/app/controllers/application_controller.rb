class ApplicationController < ActionController::API
  include SmartPagination

  before_action :set_locale
  # Declared before set_audit_user on purpose: inside that transaction the write
  # would hold a row lock on users until the response is rendered, serialising a
  # user's concurrent requests, and would be rolled back whenever a request fails.
  before_action :track_user_activity
  around_action :set_audit_user

  rescue_from(ActiveRecord::RecordInvalid) { |e| render json: {errors: e.record.errors.full_messages}, status: :unprocessable_content }

  private

  def track_user_activity
    current_user.track_activity! if current_user&.activity_stale?
  end

  def set_audit_user
    if current_user
      ActiveRecord::Base.transaction do
        ActiveRecord::Base.connection.execute(
          ActiveRecord::Base.sanitize_sql(["SET LOCAL audit.current_user_id = ?", current_user.id.to_s])
        )
        yield
      end
    else
      yield
    end
  end

  def set_locale
    I18n.locale = extract_locale || I18n.default_locale
  end

  def extract_locale
    # Option 1: From Accept-Language header
    locale = request.headers["Accept-Language"].to_s.downcase.scan(/^[a-z]{2}/)&.first

    # Only use if it's in available locales
    I18n.available_locales.map(&:to_s).include?(locale) ? locale : nil
  end

  def current_user_hub_membership(hub)
    @current_user_hub_membership ||= {}
    @current_user_hub_membership[hub.id] ||= HubMembership.find_by(user: current_user, hub: hub)
  end

  def require_member!(hub)
    return true if current_user.is_admin

    membership = current_user_hub_membership(hub)
    unless membership
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
      return false
    end
    unless membership.approved?
      render json: {error: I18n.t(:error_membership_pending_approval)}, status: :forbidden
      return false
    end
    true
  end

  def require_admin!(hub)
    return true if current_user.is_write_admin

    membership = current_user_hub_membership(hub)
    unless membership
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
      return false
    end
    if membership.approved? && membership.admin?
      true
    else
      render json: {error: I18n.t(:error_permission)}, status: :forbidden
      false
    end
  end

  def require_super_admin!
    return true if current_user&.is_admin

    render json: {error: I18n.t(:error_permission)}, status: :forbidden
    false
  end

  def require_write_super_admin!
    return true if current_user&.is_write_admin

    render json: {error: I18n.t(:error_permission)}, status: :forbidden
    false
  end
end
