class NotebookItem < ApplicationRecord
  include TrialRestrictable

  belongs_to :notebook
  belongs_to :item, polymorphic: true
  delegate :hub, to: :notebook

  validates_uniqueness_of :item_id, scope: [:item_type, :notebook_id]
  validate :not_exceed_max_items, on: :create
  validate :not_self_referencing_notebook
  validate :item_in_same_hub

  after_commit :enqueue_item_summary_generation, on: :create
  after_commit :enqueue_notebook_summary_update, on: :destroy

  scope :visible, -> {
    clusters_here = MessageCluster.where(id: where(item_type: "MessageCluster").select(:item_id))

    where.not(item_type: "Conversation", item_id: Conversation.deleted.select(:id))
      .where.not(item_type: "Message", item_id: Message.in_deleted_conversations.select(:id))
      .where.not(item_type: "MessageCluster", item_id: clusters_here.without_live_messages.select(:id))
  }

  def self.preload_items(items)
    items.group_by(&:item_type).each do |type, grouped|
      type.safe_constantize&.preload_for_serialization(grouped.map(&:item))
    end
  end

  def as_json(options = {})
    extra = {}
    extra[:item] = item.as_json(options) if options[:include_item]
    extra[:notebook] = notebook.as_json(options) if options[:include_notebook]
    super.merge(extra)
  end

  private

  def enqueue_item_summary_generation
    # Enqueue item summary generation for this specific notebook
    ItemSummaryWorker.perform_async(item_type, item_id, notebook_id)
    notebook.update_column(:ai_summary_update_requested_at, Time.now.utc)
  end

  def enqueue_notebook_summary_update
    return if notebook.nil? || notebook.destroyed?
    # Update the request timestamp and enqueue the notebook summary worker
    requested_at = Time.now.utc
    notebook.update_column(:ai_summary_update_requested_at, requested_at)
    NotebookSummaryWorker.perform_async(notebook_id, requested_at.to_f)
  end

  def not_self_referencing_notebook
    if item_type == "Notebook" && item_id == notebook_id
      errors.add(:base, I18n.t(:error_notebook_cannot_contain_itself))
    end
  end

  def item_in_same_hub
    return unless notebook && item
    errors.add(:base, I18n.t(:error_notebook_item_different_hub)) unless item.hub == notebook.hub
  end

  def not_exceed_max_items
    return unless notebook

    max_items = ENV.fetch("MAX_NOTEBOOK_ITEMS", "200").to_i
    if notebook.notebook_items.count >= max_items
      errors.add(:base, I18n.t(:error_notebook_items_limit_reached, max: max_items))
    end
  end
end
