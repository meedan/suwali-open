class ContributionHandler
  def initialize(message)
    @message = message
    @conversation = message.conversation
    @hub = @conversation.hub
  end

  def process
    return false unless @message.incoming?

    handled = false
    @conversation.with_lock do
      if @conversation.awaiting_contribution?
        handle_contribution_response
        handled = true
      elsif contains_contribution_code?
        handled = initiate_contribution_flow
      end
    end
    handled
  end

  private

  def locale
    @conversation.language
  end

  def contribution_prompt
    I18n.with_locale(locale) { I18n.t(:contribution_prompt) }
  end

  def contribution_thanks
    I18n.with_locale(locale) { I18n.t(:contribution_thanks) }
  end

  def trusted_user?
    @conversation.participant_type == "User" || @conversation.participant.trusted_user
  end

  def contribution_allowed?
    @hub.contributions_from_all_end_users? || trusted_user?
  end

  def contains_contribution_code?
    return false unless @hub.contribution_code.present?
    # End-users can't be expected to match the capitalization the hub chose for its code
    @message.body.downcase.include?(@hub.contribution_code.downcase)
  end

  def initiate_contribution_flow
    return false unless contribution_allowed?

    @conversation.set_awaiting_contribution!
    @message.update_column(:state, :user_contribution_started)
    create_response_message(contribution_prompt, :bot_contribution_started)
    true
  end

  def handle_contribution_response
    # Cancelling is handled by the "Cancel" button on the prompt (see Message#interactive_buttons and
    # WebhookServices::BaseService#handle_contribution_cancel), so any typed reply here is a submission.
    create_contribution if @conversation.platform != "internal"
    @conversation.reset_to_normal!
    @message.update_column(:state, :user_contribution_submitted)
    create_response_message(contribution_thanks, :bot_contribution_submitted)
  end

  def create_contribution
    Contribution.create!(
      message: @message,
      hub: @hub,
      content: @message.body
    )
  end

  def create_response_message(body, state)
    @conversation.messages.create!(
      direction: "outgoing",
      body: body,
      state: state
    )
  end
end
