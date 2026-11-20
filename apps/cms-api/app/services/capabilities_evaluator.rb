class CapabilitiesEvaluator
  ACTIONS = %w[
    CREATE_SOURCE
    CREATE_DOCUMENT
    MANAGE_MESSAGING_INTEGRATION
    MANAGE_SMS
    MANAGE_EXTERNAL_RESOURCE
    CREATE_CONTRIBUTION
    CREATE_MESSAGE
    CREATE_NOTE
    CREATE_NOTEBOOK_ITEM
    CREATE_NOTEBOOK
    CREATE_CONVERSATION
    APPROVE_MEMBERSHIP
    MANAGE_ADMINS
    REMOVE_EDITOR
    UPDATE_SOURCE
    REMOVE_SOURCE
    UPDATE_HUB
    MANAGE_EXTERNAL_USERS
    CREATE_TOPIC
    IS_ADMIN
    IS_WRITE_ADMIN
  ].freeze

  ADMIN_ONLY_ACTIONS = %w[
    CREATE_SOURCE
    MANAGE_MESSAGING_INTEGRATION
    MANAGE_EXTERNAL_RESOURCE
    APPROVE_MEMBERSHIP
    MANAGE_ADMINS
    REMOVE_EDITOR
    UPDATE_SOURCE
    REMOVE_SOURCE
    UPDATE_HUB
    MANAGE_EXTERNAL_USERS
    CREATE_TOPIC
  ].freeze

  def initialize(hub_membership:)
    @hub_membership = hub_membership
    @hub = hub_membership.hub
    @user = hub_membership.user
  end

  def evaluate_all
    ACTIONS.each_with_object({}) do |action, capabilities|
      capabilities[action] = evaluate(action)
    end
  end

  def evaluate(action)
    case action
    when "CREATE_SOURCE"
      evaluate_create_source
    when "CREATE_DOCUMENT"
      evaluate_create_document
    when "MANAGE_MESSAGING_INTEGRATION", "MANAGE_EXTERNAL_RESOURCE"
      evaluate_admin_and_trial_action
    when "MANAGE_SMS"
      evaluate_manage_sms
    when "MANAGE_ADMINS", "REMOVE_EDITOR", "UPDATE_HUB", "UPDATE_SOURCE", "REMOVE_SOURCE", "APPROVE_MEMBERSHIP", "MANAGE_EXTERNAL_USERS", "CREATE_TOPIC"
      evaluate_admin_only_action
    when "IS_ADMIN"
      evaluate_is_admin
    when "IS_WRITE_ADMIN"
      evaluate_is_write_admin
    when "CREATE_CONTRIBUTION", "CREATE_MESSAGE", "CREATE_NOTE", "CREATE_NOTEBOOK_ITEM", "CREATE_NOTEBOOK", "CREATE_CONVERSATION"
      evaluate_trial_restricted_creation
    else
      {allowed: false, reasons: ["unknown_action"]}
    end
  end

  private

  def evaluate_create_source
    result = evaluate_admin_and_trial_action
    return result unless result[:allowed]

    if @hub.can_add_source?
      {allowed: true}
    else
      {allowed: false, reasons: ["plan_restriction", "limit_reached"]}
    end
  end

  def evaluate_create_document
    if @hub.blocks_creation_due_to_expired_trial?
      {allowed: false, reasons: ["trial_expired"]}
    elsif @hub.can_add_document?
      {allowed: true}
    else
      {allowed: false, reasons: ["plan_restriction", "limit_reached"]}
    end
  end

  # SMS builds on the messaging-integration gate (admin + active trial) and additionally requires the
  # per-hub SMS plan limit, so the SMS section only appears for hubs entitled to it.
  def evaluate_manage_sms
    result = evaluate_admin_and_trial_action
    return result unless result[:allowed]

    if @hub.can_use_sms?
      {allowed: true}
    else
      {allowed: false, reasons: ["plan_restriction"]}
    end
  end

  def evaluate_trial_restricted_creation
    if @hub.blocks_creation_due_to_expired_trial?
      {allowed: false, reasons: ["trial_expired"]}
    else
      {allowed: true}
    end
  end

  def evaluate_admin_and_trial_action
    return {allowed: false, reasons: ["insufficient_permissions"]} unless @hub_membership.admin?

    if @hub.blocks_creation_due_to_expired_trial?
      {allowed: false, reasons: ["trial_expired"]}
    else
      {allowed: true}
    end
  end

  def evaluate_admin_only_action
    if @hub_membership.admin?
      {allowed: true}
    else
      {allowed: false, reasons: ["insufficient_permissions"]}
    end
  end

  def evaluate_is_admin
    if @user.is_admin
      {allowed: true}
    else
      {allowed: false, reasons: ["insufficient_permissions"]}
    end
  end

  def evaluate_is_write_admin
    if @user.is_write_admin
      {allowed: true}
    else
      {allowed: false, reasons: ["insufficient_permissions"]}
    end
  end
end
