class Note < ApplicationRecord
  include NotebookItemable
  include HasUniqueTitle
  include TrialRestrictable

  belongs_to :notebook
  belongs_to :user
  delegate :hub, to: :notebook

  has_one :notebook_item, as: :item

  validates :title, presence: true
  validates :content, presence: true

  after_commit :update_notebook, on: [:create, :update]
  after_create :create_notebook_item
  after_commit :enqueue_summary_generation, on: :update, if: :saved_change_to_content?

  def as_json(options = {})
    extra = {}
    extra[:notebook_item] = notebook_items.where(notebook: notebook).first if options[:include_notebook_item]
    super.merge(extra)
  end

  def title_exists?
    Note.exists?(title: title, notebook: notebook, user: user)
  end

  def text_for_summarization
    content
  end

  private

  def update_notebook
    notebook.update_column(:updated_at, Time.now)
  end

  def create_notebook_item
    NotebookItem.create! item: self, notebook: notebook
  end

  def enqueue_summary_generation
    # Clear existing summary so it gets regenerated
    update_column(:ai_summary, nil)
    ItemSummaryWorker.perform_async("Note", id, notebook_id)
    notebook.update_column(:ai_summary_update_requested_at, Time.now.utc)
  end
end
