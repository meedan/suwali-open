class Contribution < ApplicationRecord
  include HubAccessible
  include NotebookItemable
  include MessageDataSourceItemable
  include Topicable
  include KnowledgeServiceSyncable
  include TrialRestrictable
  include LabelOrderable

  belongs_to :message
  belongs_to :hub

  scope :ordered_by_participant_name, ->(direction) {
    joins(message: :conversation).order_by_label(Conversation::PARTICIPANT_LABEL_SQL, direction)
  }

  scope :from_end_users, ->(trusted:) { joins(message: :conversation).merge(Conversation.from_end_users(trusted: trusted)) }

  before_validation :set_active_from_hub_workflow, on: :create

  validates :content, presence: true

  before_create :claim_first_contribution

  after_commit :send_to_knowledge_service, on: :create
  after_commit :extract_topics_from_knowledge_service, on: :create, unless: :active?
  after_commit :remove_from_knowledge_service, on: :destroy

  # Contributions always come from end-users; an internal participant has no contributor history
  def contributor
    participant = message.conversation.participant
    participant if participant.is_a?(ExternalUser)
  end

  def as_json(_options = {})
    super.merge(
      message: message.as_json(include_conversation: true),
      topics: sorted_topic_items,
      first_contribution_at: contributor&.first_contribution_at
    )
  end

  def text_for_summarization
    content
  end

  def title
    content.to_s.truncate(64)
  end

  def data_source_payload
    {
      id: id,
      title: title,
      content: content,
      updated_at: updated_at,
      active: active,
      priority_tier: priority_tier,
      message: {
        conversation: {
          platform: message.conversation.platform,
          participant: {
            name: message.conversation.participant.respond_to?(:display_name) ? message.conversation.participant.display_name : message.conversation.participant.name,
            trusted_user: message.conversation.participant.respond_to?(:trusted_user) ? message.conversation.participant.trusted_user : false,
            type: message.conversation.participant_type
          }
        }
      }
    }
  end

  private

  # Records what was true when the contribution arrived, rather than something recomputed later: a
  # deleted first contribution does not promote the next one, so past figures never change. The
  # conditional update is what settles the race between two contributions from the same person —
  # only the one that fills the column in claims the flag.
  def claim_first_contribution
    return unless contributor

    claimed = ExternalUser
      .where(id: contributor.id, first_contribution_at: nil)
      .update_all(first_contribution_at: created_at || Time.current)

    self.first_time_contributor = claimed == 1
  end

  def send_to_knowledge_service
    KnowledgeServiceWorker.perform_in(5.seconds, "ingest_community_knowledge", id) if active?
  end

  def extract_topics_from_knowledge_service
    KnowledgeServiceWorker.perform_async("extract_community_knowledge_topics", id)
  end

  def remove_from_knowledge_service
    KnowledgeServiceWorker.perform_in(5.seconds, "delete_community_knowledge", id, hub_id)
  end

  def set_active_from_hub_workflow
    self.active = hub.direct? if hub.present? && !active_changed?
  end
end
