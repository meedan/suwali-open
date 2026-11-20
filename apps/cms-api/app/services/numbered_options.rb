# Platforms without tappable buttons (SMS, Signal) list a message's interactive options as numbered
# instructions. The number => callback map is stored on the message under a per-platform metadata key,
# so a reply with one of those numbers can be routed back into the existing button-callback flow.
module NumberedOptions
  # How many recent outgoing messages are searched for the options a reply refers to
  LOOKBACK = 10

  # Returns the instructions to append to the message body, and the number => callback map to store
  def self.render(buttons, language)
    options = {}
    lines = buttons.each_with_index.map do |button, index|
      number = (index + 1).to_s
      options[number] = button[:id]
      I18n.with_locale(language) { I18n.t(:text_button_instruction, number: number, label: button[:text]) }
    end
    ["\n\n#{lines.join("\n")}", options]
  end

  # The callback data a reply selects from the most recent message that offered options, if any
  def self.callback_for_reply(conversation, metadata_key, reply)
    token = reply.to_s.strip
    return nil if token.blank?

    message = conversation.messages.outgoing.order("id DESC").limit(LOOKBACK)
      .detect { |candidate| candidate.metadata.to_h[metadata_key].present? }
    return nil if message.nil?

    message.metadata.to_h[metadata_key].to_h[token].presence
  end
end
