class ItemSummaryWorker
  include Sidekiq::Worker
  sidekiq_options queue: :knowledge_service, retry: 3
  sidekiq_retry_in { |count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted do |msg, _exception|
    LogService.log(:error, "ItemSummaryWorker", "Retries exhausted after 3 attempts - Item: #{msg["args"][0]}/#{msg["args"][1]}, Job ID: #{msg["jid"]}")
  end

  MIN_TEXT_LENGTH_FOR_SUMMARIZATION = 200

  def perform(item_type, item_id, notebook_id = nil)
    item = item_type.constantize.find(item_id)

    generate_summary(item) if item.effective_summary.blank?

    trigger_notebook_summary_update(notebook_id)
  rescue KnowledgeService::TooLongMessageError => e
    LogService.log(:warn, "ItemSummaryWorker", "Content too large to summarize for #{item_type} #{item_id}, will not retry: #{e.message}")
    trigger_notebook_summary_update(notebook_id)
  rescue => e
    LogService.log(:error, "ItemSummaryWorker", "Error generating summary for #{item_type} #{item_id}, will retry: #{e.class} - #{e.message}")
    raise e # Let Sidekiq handle retries
  end

  private

  def generate_summary(item)
    text = item.text_for_summarization

    if text.present?
      generate_summary_from_text(item, text)
    else
      generate_summary_from_ingested_content(item)
    end
  end

  def generate_summary_from_text(item, text)
    if text.length < MIN_TEXT_LENGTH_FOR_SUMMARIZATION
      item.update_column(:ai_summary, text)
      LogService.log(:info, "ItemSummaryWorker", "Using text as-is for #{item.class.name} #{item.id} (length: #{text.length})")
    else
      summary = KnowledgeService.summarize(text, default_language: item.hub.default_language)
      item.update_column(:ai_summary, summary) if summary.present?
      LogService.log(:info, "ItemSummaryWorker", "Generated AI summary for #{item.class.name} #{item.id} (length: #{text.length})")
    end
  end

  def generate_summary_from_ingested_content(item)
    summary = item.try(:summarize_ingested_content)

    if summary.present?
      item.update_column(:ai_summary, summary)
      LogService.log(:info, "ItemSummaryWorker", "Generated AI summary from ingested content for #{item.class.name} #{item.id}")
    else
      LogService.log(:info, "ItemSummaryWorker", "No ingested-content summary available for #{item.class.name} #{item.id}")
    end
  end

  def trigger_notebook_summary_update(notebook_id)
    requested_at = Time.now.utc
    notebook = Notebook.find(notebook_id)
    notebook.update_column(:ai_summary_update_requested_at, requested_at)
    NotebookSummaryWorker.perform_async(notebook_id, requested_at.to_f)
  end
end
