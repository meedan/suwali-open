class DestroyConversationWithMessagesWorker < SoftDeleteWorker
  private

  def parent_class = Conversation

  def children_association = :messages
end
