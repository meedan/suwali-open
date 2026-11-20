class MessageReport < ApplicationRecord
  belongs_to :message
  belongs_to :reported_by, class_name: "User"

  validate :message_must_be_a_bot_message

  scope :in_hub, ->(hub) { where(message: Message.where(conversation: hub.conversations)) }

  private

  def message_must_be_a_bot_message
    return if message.direction == "outgoing"

    errors.add(:base, I18n.t(:error_message_report_must_be_bot_message))
  end
end
