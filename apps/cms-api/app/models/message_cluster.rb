class MessageCluster < ApplicationRecord
  include HubAccessible
  include NotebookItemable

  belongs_to :hub
  belongs_to :centroid_message, class_name: "Message", optional: true
  has_many :messages, dependent: :nullify
  has_one :last_replied_external_message,
    -> { in_live_conversations.external_with_bot_reply.order(created_at: :desc) },
    class_name: "Message",
    foreign_key: :message_cluster_id

  validates :centroid_embedding, :original_text, :hub_id, presence: true

  before_update :reset_ai_summary, if: :will_save_change_to_original_text?
  after_commit :resummarize_in_notebooks, on: :update, if: :saved_change_to_original_text?

  scope :without_live_messages, -> {
    where.not(Message.in_live_conversations.where("messages.message_cluster_id = message_clusters.id").arel.exists)
  }

  # Within a window it is the last message in that window that decides the status, so a question
  # asked again later does not move the cluster out of the period being reported on.
  scope :with_last_external_message_answered, ->(answered, window = nil) {
    last_message = Message
      .where("messages.message_cluster_id = message_clusters.id")
      .in_live_conversations
      .external_with_bot_reply
      .order(created_at: :desc)
      .select("bot_reply.answered")
      .limit(1)
    last_message = last_message.where(created_at: window) if window

    where("(#{last_message.to_sql}) = ?", answered)
  }

  has_neighbors :centroid_embedding

  def as_json(_options = {})
    last_message = last_replied_external_message
    answered = last_message&.reply&.answered

    super
      .except("centroid_embedding")
      .merge({
        "last_message_body" => last_message&.body || original_text,
        "last_message_answered_status" => answered,
        "current_answered_status_count" => (messages.in_live_conversations.external_with_answered_bot_reply(answered).count unless answered.nil?)
      })
  end

  def questions_ranking_payload
    {
      id: id,
      original_text: original_text,
      question_count: question_count,
      centroid_message_id: centroid_message_id,
      last_message_body: last_replied_external_message&.body
    }
  end

  def self.preload_for_serialization(records)
    ActiveRecord::Associations::Preloader.new(records: records, associations: [{last_replied_external_message: :reply}]).call
  end

  def text_for_summarization
    original_text
  end

  private

  def reset_ai_summary
    self.ai_summary = nil
  end

  def resummarize_in_notebooks
    notebooks.update_all(ai_summary_update_requested_at: Time.now.utc)
    notebook_items.each { |notebook_item| ItemSummaryWorker.perform_async("MessageCluster", id, notebook_item.notebook_id) }
  end
end
