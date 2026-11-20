class MessageSenderServices::BaseService
  attr_reader :message

  def initialize(message)
    @message = message
  end

  def send_message
    raise NotImplementedError, "Subclasses must implement #send_message"
  end

  protected

  def hub
    @hub ||= message.hub
  end

  def conversation
    @conversation ||= message.conversation
  end

  def external_user
    @external_user ||= conversation.participant
  end

  def formatted_body
    @formatted = false
    if intermediary_message?
      @formatted = true
      format_italic(message.body)
    else
      message.body
    end
  end

  def format_italic(text)
    text
  end

  def intermediary_message?
    message.bot_intermediary_message? || message.bot_processing?
  end
end
