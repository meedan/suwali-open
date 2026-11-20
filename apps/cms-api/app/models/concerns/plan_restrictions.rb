module PlanRestrictions
  extend ActiveSupport::Concern

  # free_unrestricted and enterprise are intentionally absent:
  #   free_unrestricted: nil (unlimited while trial active)
  #   enterprise: nil (overridden per-hub via custom_limits)
  PLAN_LIMITS = {
    sources: {free: 3, subsidized: 5, standard: 5, pro: 10},
    documents: {free: 100, subsidized: 500, standard: 500, pro: 1000},
    messages: {free: 1000, subsidized: 1000, standard: 2000, pro: 7500}
  }.freeze

  def can_add_source?
    max = max_sources_for_plan
    max.nil? || sources.not_deleted.count < max
  end

  def can_add_document?
    max = max_documents_for_plan
    max.nil? || total_documents < max
  end

  # SMS is sold only on these plans; the others (free, free_unrestricted, subsidized) do not include it
  # at all, so the per-hub toggle cannot grant it.
  SMS_PLANS = %w[standard pro enterprise].freeze

  # On top of being on an eligible plan, SMS is turned on per-hub by a super-admin
  # (custom_limits["sms"]), so it is off by default until explicitly enabled. See SmsMessagingIntegration.
  def can_use_sms?
    plan.in?(SMS_PLANS) && custom_limits&.dig("sms") == true
  end

  def source_limit_error
    I18n.t(:error_plan_restriction_max_sources_reached, max: max_sources_for_plan)
  end

  def document_limit_error
    I18n.t(:error_plan_restriction_max_documents_reached, max: max_documents_for_plan)
  end

  def sms_restriction_error
    I18n.t(:error_plan_restriction_sms_not_available)
  end

  def blocks_creation_due_to_expired_trial?
    free? && trial_expired?
  end

  def trial_expiration_error
    I18n.t(:error_plan_restriction_trial_expired)
  end

  def active_external_users_count
    external_users.active.count
  end

  def max_sources_for_plan
    return custom_limits&.dig("sources") if enterprise?
    PLAN_LIMITS[:sources][plan.to_sym]
  end

  def max_documents_for_plan
    return custom_limits&.dig("documents") if enterprise?
    PLAN_LIMITS[:documents][plan.to_sym]
  end

  # Non-blocking: nothing enforces this limit, it only feeds pricing/admin displays.
  def max_messages_for_plan
    return custom_limits&.dig("messages") if enterprise?
    PLAN_LIMITS[:messages][plan.to_sym]
  end

  # Messages the bot sent to end-users since the start of the current calendar month, which is the
  # usage the monthly message allowance is measured against.
  def monthly_messages_count
    Message
      .outgoing
      .joins(:conversation)
      .where.not("conversations.platform" => "internal")
      .where("conversations.hub_id" => id)
      .where("messages.created_at" => Time.current.beginning_of_month..)
      .count
  end

  private

  def total_documents
    Document.joins(:source).where("sources.hub_id" => id, "sources.deleted_at" => nil).count
  end
end
