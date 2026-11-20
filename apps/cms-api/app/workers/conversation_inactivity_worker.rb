class ConversationInactivityWorker
  include Sidekiq::Worker
  sidekiq_options queue: :messaging, retry: 0

  def perform(message_id)
    triggering_message = Message.find_by(id: message_id)
    return unless triggering_message

    conversation = triggering_message.conversation
    return unless conversation

    return if conversation.substantive_reply_since?(triggering_message.created_at)

    # Build the full body (including the topics sentence) before saving, because saving is what
    # enqueues the send to WhatsApp/Telegram. The Subscribe button comes from interactive_buttons.
    message = conversation.messages.new(direction: "outgoing", state: :closed_window)
    topic_names = message.top_topics.map(&:name)

    last_message_id = conversation.messages.maximum(:id)
    message.body = conversation.hub.closed_message_for_conversation(conversation.language, topic_names)

    # Generating can take a few seconds on a cache miss, and the user may have come back meanwhile. Incoming
    # messages are checked too because a reply shown as a typing indicator creates no outgoing message yet.
    return if conversation.substantive_reply_since?(triggering_message.created_at) ||
      conversation.messages.where(direction: :incoming).where("id > ?", last_message_id).exists?

    message.save!
  end
end
