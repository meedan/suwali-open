class TopicSubscription < ApplicationRecord
  belongs_to :topic
  belongs_to :external_user

  delegate :hub, to: :topic

  validates :external_user_id, uniqueness: {scope: :topic_id}
  validate :external_user_in_topic_hub

  private

  def external_user_in_topic_hub
    return unless topic && external_user

    if topic.hub_id != external_user.hub_id
      errors.add(:external_user, I18n.t(:error_topic_subscription_hub_mismatch))
    end
  end
end
