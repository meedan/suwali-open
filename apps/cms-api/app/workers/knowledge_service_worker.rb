class KnowledgeServiceWorker
  include Sidekiq::Worker
  sidekiq_options queue: :knowledge_service, retry: 3
  sidekiq_retry_in { |count, _exception, _jobhash| 1.minute }

  sidekiq_retries_exhausted do |msg, _exception|
    operation = msg["args"][0]
    object_id = msg["args"][1]

    if operation == "chat"
      message = Message.find_by_id(object_id)
      if message
        message.conversation.messages.create!(
          direction: "outgoing",
          body: I18n.with_locale(message.conversation.language) { I18n.t(:error_create_chat_response_message) },
          state: :knowledge_service_error,
          reply_to: message
        )
        ConversationRateLimiter.new(message.conversation).release!
      end
    end

    LogService.log(:error, "KnowledgeServiceWorker", "Retries exhausted after 3 attempts - Operation: #{operation}, ID: #{object_id}, Job ID: #{msg["jid"]}")
  end

  def perform(operation, object_id, hub_id = nil)
    case operation.to_sym
    when :chat
      chat(object_id)
    when :ingest_document
      ingest_document(object_id)
    when :delete_document
      delete_document(object_id, hub_id)
    when :ingest_notebook_summary
      ingest_notebook_summary(object_id)
    when :delete_notebook_summary
      delete_notebook_summary(object_id, hub_id)
    when :ingest_community_knowledge
      ingest_community_knowledge(object_id)
    when :delete_community_knowledge
      delete_community_knowledge(object_id, hub_id)
    when :extract_community_knowledge_topics
      extract_community_knowledge_topics(object_id)
    when :sync_topics
      sync_topics(object_id)
    end
  rescue => e
    LogService.log(:error, "KnowledgeServiceWorker", "Error in operation #{operation} for ID #{object_id}, will retry: #{e.class} - #{e.message}")
    raise e # Let Sidekiq handle retries
  end

  private

  def ingest_document(document_id)
    document = Document.find(document_id)
    url = document.proxied_url(host: ENV.fetch("CMS_API_INTERNAL_URL", "http://cms-api:3000"))
    original_url = document.external_url  # original article URL from metadata to use for classification (if present)
    published_at = document.published_at&.iso8601
    LogService.log(:warn, "KnowledgeServiceWorker", "No file URL found for document #{document.id} when trying to send it to Knowledge Service") if url.blank?
    KnowledgeService.ingest(document.source.hub_id, Base64.encode64("Document/#{document.id}"), url, nil, original_url, published_at, document.priority_tier, document.source.hub.topic_names, false, "document", document.summary) unless url.blank?
  end

  def delete_document(document_id, hub_id)
    KnowledgeService.delete(hub_id, Base64.encode64("Document/#{document_id}"))
  end

  def ingest_notebook_summary(notebook_id)
    notebook = Notebook.find(notebook_id)
    summary = notebook.summary.to_s
    KnowledgeService.ingest(notebook.hub_id, Base64.encode64("Notebook/#{notebook.id}"), nil, summary, nil, nil, notebook.priority_tier, notebook.hub.topic_names, true, "notebook") if notebook.published? && !summary.blank? && notebook.active
  end

  def delete_notebook_summary(notebook_id, hub_id)
    notebook = Notebook.find_by_id(notebook_id)
    KnowledgeService.delete(hub_id, Base64.encode64("Notebook/#{notebook_id}")) if !notebook || !notebook.published? || !notebook.active
  end

  def ingest_community_knowledge(contribution_id)
    contribution = Contribution.find(contribution_id)
    KnowledgeService.ingest(contribution.hub_id, Base64.encode64("Contribution/#{contribution.id}"), nil, contribution.content, nil, nil, contribution.priority_tier, contribution.hub.topic_names, false, "contribution")
  end

  def delete_community_knowledge(contribution_id, hub_id)
    KnowledgeService.delete(hub_id, Base64.encode64("Contribution/#{contribution_id}"))
  end

  # Paused contributions are not ingested, so their topics are extracted from the content directly.
  # Ingestion overwrites them if the contribution is published later.
  def extract_community_knowledge_topics(contribution_id)
    contribution = Contribution.find(contribution_id)
    hub = contribution.hub
    names = KnowledgeService.extract_topics(hub.id, Base64.encode64("Contribution/#{contribution.id}"), hub.topic_names, contribution.content)
    contribution.assign_topic_names(names)
  end

  def sync_topics(item_ref)
    Rails.cache.delete(KnowledgeServiceSyncable.topics_sync_key(item_ref))

    class_name, item_id = item_ref.split("/")
    return unless KnowledgeServiceSyncable::SYNCABLE_CLASSES.include?(class_name)

    item = class_name.constantize.find_by(id: item_id) # nosemgrep: ruby.rails.security.brakeman.check-unsafe-reflection.check-unsafe-reflection -- class_name is checked against a literal allowlist above
    return unless item&.topics_syncable?

    KnowledgeService.update_topics(item.hub.id, Base64.encode64("#{class_name}/#{item.id}"), item.topics.pluck(:name))
  end

  def chat(message_id)
    message = Message.find_by_id(message_id)
    return if message.nil?
    return unless message.direction == "incoming"

    hub = message.hub
    personalization =
      message.metadata["personalization_snapshot"]&.deep_symbolize_keys ||
      hub.personalization_for_knowledge_service

    KnowledgeService.chat(
      hub.id,
      message.id,
      message.body,
      message.history_for_knowledge_service(exclude_before_closed_window: true),
      personalization,
      hub.should_prioritize_recent_documents?,
      hub.topic_names,
      message.conversation.context_for_knowledge_service,
      hub.location_gate_enabled?
    )
    # Answer arrives via callback to KnowledgeServiceCallbacksController#update_chat_status
  end
end
