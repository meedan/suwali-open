class NotebookSummaryWorker
  include Sidekiq::Worker
  sidekiq_options queue: :knowledge_service, retry: 3
  sidekiq_retry_in { |count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted do |msg, _exception|
    LogService.log(:error, "NotebookSummaryWorker", "Retries exhausted after 3 attempts - Notebook ID: #{msg["args"][0]}, Job ID: #{msg["jid"]}")
  end

  def perform(notebook_id, requested_at_timestamp)
    notebook = Notebook.find(notebook_id)

    # Race condition check: if there's a more recent request, this is a no-op
    if notebook.ai_summary_update_requested_at && notebook.ai_summary_update_requested_at.to_f > requested_at_timestamp.to_f
      LogService.log(:info, "NotebookSummaryWorker", "Skipping notebook #{notebook_id}, more recent update requested (#{notebook.ai_summary_update_requested_at.to_f} > #{requested_at_timestamp.to_f})")
      return
    end

    # Get the last 100 items added to the notebook, ordered by creation date
    items = notebook.notebook_items.visible
      .order(created_at: :desc)
      .limit(Notebook::SUMMARY_ITEM_LIMIT)
      .includes(:item)
      .map(&:item)
      .compact

    # Every item was removed, so the old summary would describe content that is gone
    if items.empty?
      notebook.update_columns(ai_summary: nil, ai_summary_updated_at: Time.now.utc)
      LogService.log(:info, "NotebookSummaryWorker", "Notebook #{notebook_id} has no items, cleared its summary")
      clear_pending_request(notebook_id, requested_at_timestamp)
      return
    end

    if items.any? { |item| item.try(:awaiting_sync_for_summary?) }
      LogService.log(:info, "NotebookSummaryWorker", "Notebook #{notebook_id} has an item awaiting Knowledge Service sync, will resume once it settles")
      return
    end

    unless items.all?(&:summarizable?)
      LogService.log(:info, "NotebookSummaryWorker", "Notebook #{notebook_id} has an item that cannot be summarized")
      clear_pending_request(notebook_id, requested_at_timestamp)
      return
    end

    # Filter items that have a summary and collect their summaries
    item_summaries = items.map(&:effective_summary).select(&:present?)

    # If no summaries available, nothing to do
    if item_summaries.empty?
      LogService.log(:info, "NotebookSummaryWorker", "No item summaries available for notebook #{notebook_id}")
      clear_pending_request(notebook_id, requested_at_timestamp)
      return
    end

    # Generate notebook summary from item summaries
    summary = KnowledgeService.summarize(item_summaries, default_language: notebook.hub.default_language)

    if summary.present?
      notebook.update_columns(ai_summary: summary, ai_summary_updated_at: Time.now.utc)
      LogService.log(:info, "NotebookSummaryWorker", "Generated summary for notebook #{notebook_id} from #{item_summaries.count} items")
    else
      LogService.log(:warn, "NotebookSummaryWorker", "No summary returned for notebook #{notebook_id} from #{item_summaries.count} items")
      clear_pending_request(notebook_id, requested_at_timestamp)
    end
  rescue => e
    LogService.log(:error, "NotebookSummaryWorker", "Error generating summary for notebook #{notebook_id}, will retry: #{e.class} - #{e.message}")
    raise e # Let Sidekiq handle retries
  end

  private

  def clear_pending_request(notebook_id, requested_at_timestamp)
    # Comparing at full float precision occasionally misses the row; millisecond granularity is all this needs.
    Notebook.where(id: notebook_id)
      .where("date_trunc('millisecond', ai_summary_update_requested_at) <= ?", Time.at(requested_at_timestamp).floor(3))
      .update_all(ai_summary_update_requested_at: nil)
  end
end
