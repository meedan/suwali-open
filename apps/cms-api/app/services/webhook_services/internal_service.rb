class WebhookServices::InternalService < WebhookServices::BaseService
  def valid?
    payload[:id].present? && payload[:type].present?
  end

  def process(conversation)
    return unless valid?
    return unless conversation

    handle_button_callback(payload[:id], conversation, payload)
  end
end
