module NotebookItemable
  extend ActiveSupport::Concern

  included do
    has_many :notebook_items, as: :item, dependent: :destroy
    has_many :notebooks, through: :notebook_items
  end

  def effective_summary
    ai_summary
  end

  def summarizable?
    effective_summary.present? || text_for_summarization.present?
  end

  class_methods do
    def preload_for_serialization(_records)
      # no-op by default; override in models that require eager loading for serialization
    end
  end
end
