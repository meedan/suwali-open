class Notebook < ApplicationRecord
  SUMMARY_ITEM_LIMIT = 100

  include HasUniqueTitle
  include HubAccessible
  include MessageDataSourceItemable
  include Topicable
  include KnowledgeServiceSyncable
  include TrialRestrictable
  include LabelOrderable

  attr_accessor :summary_updater
  alias_attribute :title, :name

  belongs_to :hub
  belongs_to :user

  scope :by_hub_members, -> {
    where("EXISTS (SELECT 1 FROM hub_memberships WHERE hub_memberships.hub_id = notebooks.hub_id AND hub_memberships.user_id = notebooks.user_id AND hub_memberships.approved = true)")
  }
  scope :published_for, ->(user) {
    published = where(published: true)
    user.is_admin ? published : published.by_hub_members
  }
  # The last editor is shown by name, falling back to email; notebooks nobody edited come last
  scope :ordered_by_last_editor_name, ->(direction) {
    order_by_label("(SELECT LOWER(COALESCE(NULLIF(u.name, ''), u.email)) FROM users u WHERE u.id = notebooks.last_summary_updated_by_id)", direction)
  }
  belongs_to :last_summary_updated_by, class_name: "User", optional: true
  has_many :notes, dependent: :destroy
  has_many :notebook_items, dependent: :destroy
  has_many :messages, through: :notebook_items, source: :item, source_type: "Message"
  has_many :conversations, through: :notebook_items, source: :item, source_type: "Conversation"
  has_many :documents, through: :notebook_items, source: :item, source_type: "Document"
  has_many :message_clusters, through: :notebook_items, source: :item, source_type: "MessageCluster"
  has_many :child_notebooks, through: :notebook_items, source: :item, source_type: "Notebook"

  # NotebookItemable equivalent (can't use the concern due to :notebook_items name conflict)
  has_many :notebook_items_as_item, class_name: "NotebookItem", as: :item, dependent: :destroy
  has_many :parent_notebooks, through: :notebook_items_as_item, source: :notebook

  before_validation :copy_ai_summary_to_summary, on: :update, if: :published?
  validates :name, presence: true
  validates :summary, presence: true, if: :published?
  validate :summary_unchangeable_when_published, on: :update

  before_save :track_summary_updater, if: :will_save_change_to_summary?
  before_destroy :auto_unpublish_if_published
  after_commit :handle_publication, if: :saved_change_to_published?, on: [:create, :update]

  def as_json(options = {})
    extra = {topics: sorted_topic_items}
    if options[:include_user]
      extra[:user] = user.as_json(options)
      extra[:summary_updated_by] = last_summary_updated_by.as_json(options)
    end
    extra[:summarizable] = all_items_summarizable? if options[:include_summarizable]
    super.merge(extra)
  end

  def publish
    self.published = true
    save
  end

  def unpublish
    self.published = false
    save
  end

  def items
    notebook_items
  end

  def items_as_item
    notebook_items_as_item
  end

  def self.preload_for_serialization(_records)
    # no-op; required by NotebookItem.preload_items
  end

  def text_for_summarization
    summary.presence || ai_summary
  end

  # Duplicated from NotebookItemable, which Notebook cannot include: its notebook_items association collides.
  def effective_summary
    summary.presence || ai_summary
  end

  def summarizable?
    ai_summary.present? || text_for_summarization.present?
  end

  def all_items_summarizable?
    notebook_items.visible.order(created_at: :desc).limit(SUMMARY_ITEM_LIMIT)
      .includes(:item).all? { |notebook_item| notebook_item.item&.summarizable? }
  end

  def title_exists?
    Notebook.exists?(name: title, hub: hub, user: user)
  end

  def data_source_payload
    {
      name: name,
      summary: summary,
      published_at: published_at,
      updated_at: updated_at,
      active: active,
      priority_tier: priority_tier,
      user: {
        name: user.name,
        email: user.email,
        profile_picture_url: user.profile_picture_url
      }
    }
  end

  def schedule_regenerate_ai_summary!
    requested_at = Time.current
    update_column(:ai_summary_update_requested_at, requested_at)
    NotebookSummaryWorker.perform_async(id, requested_at.to_f)
  end

  def topics_syncable?
    super && published?
  end

  private

  def copy_ai_summary_to_summary
    self.summary = ai_summary if summary.blank?
  end

  def track_summary_updater
    self.last_summary_updated_by = summary_updater if summary_updater
    self.summary_updated_at = Time.current
  end

  def handle_publication
    if published?
      update_columns(published_at: Time.now, sync_status: :pending)
      send_to_knowledge_service
    else
      update_column(:sync_status, :pending)
      remove_from_knowledge_service
    end
  end

  def send_to_knowledge_service
    KnowledgeServiceWorker.perform_in(30.seconds, "ingest_notebook_summary", id)
  end

  def remove_from_knowledge_service
    KnowledgeServiceWorker.perform_in(30.seconds, "delete_notebook_summary", id, hub_id)
  end

  def summary_unchangeable_when_published
    if published_was && summary_changed?
      errors.add(:base, I18n.t(:error_cant_change_notebook_summary_while_published))
    end
  end

  def auto_unpublish_if_published
    if published?
      update_column(:published, false)
      remove_from_knowledge_service
    end
  end
end
