module ClusterQuestionHelper
  # An external question in the cluster plus the bot reply that settles its answered status.
  # Returns the question.
  def ask_clustered_question(conversation, cluster, answered:, **question_attributes)
    question = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, **question_attributes)
    create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: question, answered: answered)
    question
  end
end
