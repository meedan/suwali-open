class AuthenticatedController < ApplicationController
  before_action :authenticate_user!
  after_action :verify_hub_authorized!

  class_attribute :skip_hub_authorization_actions, default: []

  def self.skip_hub_authorization(*actions)
    self.skip_hub_authorization_actions = skip_hub_authorization_actions | actions.map(&:to_sym)
  end

  private

  def require_member!(hub)
    result = super
    @_hub_authorized = true
    result
  end

  def require_admin!(hub)
    result = super
    @_hub_authorized = true
    result
  end

  def verify_hub_authorized!
    return if @_hub_authorized
    return if self.class.skip_hub_authorization_actions.include?(action_name.to_sym)
    return unless response.successful?

    raise "#{self.class}##{action_name} did not verify hub authorization. Call `require_member!` or `require_admin!` in the action, or use `skip_hub_authorization :#{action_name}`."
  end
end
