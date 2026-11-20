class KnowledgeService
  class Error < StandardError; end

  class TooLongMessageError < StandardError; end

  BASE_URL = ENV.fetch("KNOWLEDGE_SERVICE_URL", "http://knowledge:8000")

  def self.ingest(hub_id, document_id, file_url = nil, text = nil, original_url = nil, published_at = nil, priority_tier = nil, existing_topics = [], text_is_markdown = false, data_source_item_type = nil, summary = nil)
    payload = {
      hub_id: hub_id.to_i,
      document_id: document_id.to_s,
      file_url: file_url.to_s,
      text: text.to_s,
      original_url: original_url.to_s,
      published_at: published_at.to_s,
      existing_topics: existing_topics.to_a,
      text_is_markdown: !!text_is_markdown,
      callback_url: generate_document_callback_url(document_id)
    }
    payload[:priority_tier] = priority_tier.to_i if priority_tier
    # What the CMS calls a data source item (Document, Notebook, Contribution) the Knowledge Service
    # calls a document, so the name changes at this boundary. Not to be confused with
    # Document#document_type, which is the file format (pdf, docx, …).
    payload[:document_type] = data_source_item_type.to_s if data_source_item_type.present?
    payload[:summary] = summary.to_s if summary.present?
    response = request("post", "document", payload)
    status = response["status"]
    !status.nil? && status != "failed"
  end

  def self.delete(hub_id, document_id)
    payload = {
      hub_id: hub_id.to_i,
      document_id: document_id.to_s,
      callback_url: generate_document_callback_url(document_id)
    }
    response = request("delete", "document", payload)
    if response.is_a?(Hash)
      response["status"] == "queued"
    else
      response.status.to_i == 204
    end
  end

  # Extract topics without ingesting (cheap, synchronous). When text is blank the Knowledge Service
  # reads the document's already-ingested chunks, so items that were never ingested must pass it.
  def self.extract_topics(hub_id, document_id, existing_topics = [], text = nil)
    payload = {
      hub_id: hub_id.to_i,
      document_id: document_id.to_s,
      text: text.to_s,
      existing_topics: existing_topics.to_a
    }
    response = request("post", "topics", payload)
    response.is_a?(Hash) ? response["topics"].to_a : []
  end

  def self.update_topics(hub_id, document_id, topics)
    payload = {hub_id: hub_id.to_i, document_id: document_id.to_s, topics: topics.to_a}
    request("put", "document/topics", payload)
    true
  end

  def self.chat(hub_id, message_id, message_body, history = [], personalization = {}, recency_first_enabled = nil, existing_topics = [], conversation_context = nil, location_gate_enabled = nil)
    payload = {
      hub_id: hub_id.to_i,
      message_id: message_id.to_i,
      message: message_body.to_s,
      history: history,
      existing_topics: existing_topics.to_a,
      callback_url: generate_chat_callback_url(message_id)
    }
    payload[:personalization] = personalization if personalization.any?
    payload[:recency_first_enabled] = recency_first_enabled unless recency_first_enabled.nil?
    payload[:conversation_context] = conversation_context unless conversation_context.nil?
    payload[:location_gate_enabled] = location_gate_enabled unless location_gate_enabled.nil?

    request("post", "chat", payload)
    # Returns job status; the answer arrives via callback
  end

  # Pass texts for raw text, or hub_id/document_id to summarize a document's already-ingested
  # chunks (no text round-trip required).
  def self.summarize(texts = nil, hub_id: nil, document_id: nil, default_language: nil)
    payload = texts ? {texts: [texts].flatten} : {hub_id: hub_id.to_i, document_id: document_id.to_s}
    payload[:default_language] = default_language if default_language.present?
    response = request("post", "summarize", payload)
    response["summary"]
  end

  def self.preview(scenario, personalization)
    payload = {
      scenario: scenario.to_s,
      personalization: personalization
    }
    response = request("post", "preview", payload)
    response["answer"]
  end

  # Returns an ISO 639-1 code, or nil when the text carries no clear language
  def self.detect_language(text, default_language = nil, supported_languages = [])
    payload = {text: text.to_s, default_language: default_language, supported_languages: supported_languages.to_a}
    response = request("post", "language", payload, 5)
    response["language"]
  end

  def self.embed(text)
    payload = {
      text: text
    }
    response = request("post", "embed", payload)
    response["embedding"]
  end

  def self.health
    request("get", "health")
  end

  def self.generate_chat_callback_url(message_id)
    generate_callback_url("update-chat-status", "message_id", message_id)
  end

  def self.generate_document_callback_url(document_id)
    generate_callback_url("update-sync-status", "id", document_id)
  end

  def self.generate_callback_url(endpoint, parameter_name, parameter_value)
    base_url = ENV.fetch("CMS_API_INTERNAL_URL", "http://cms-api:3000")
    token = ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] || ""
    "#{base_url}/api/knowledge-service-callbacks/#{endpoint}?#{parameter_name}=#{CGI.escape(parameter_value.to_s)}&token=#{CGI.escape(token)}"
  end

  # Identifiers only: payloads can carry end users' messages, and error logs reach Sentry
  def self.loggable_payload(payload)
    payload.slice(:hub_id, :document_id, :message_id, :scenario).to_json
  end

  def self.request(verb, endpoint, payload = {}, timeout = 300)
    conn = Faraday.new(url: BASE_URL) do |f|
      f.options.timeout = timeout
    end

    response = conn.public_send(verb, "/#{endpoint}/") do |req|
      if verb.to_s.downcase != "get"
        req.headers["Content-Type"] = "application/json"
        req.body = payload.to_json
      end
    end

    unless response.success?
      raise TooLongMessageError, response.body if response.status == 422

      error_message = "Request to endpoint /#{endpoint} failed with status #{response.status}: #{response.body}"
      LogService.log(:error, "KnowledgeService", "HTTP request failed: #{verb.upcase} /#{endpoint}/ - Status: #{response.status} - Payload: #{loggable_payload(payload)}")
      raise Error, error_message
    end

    begin
      JSON.parse(response.body)
    rescue
      response
    end
  rescue Faraday::TimeoutError
    LogService.log(:error, "KnowledgeService", "Request timeout (#{timeout}s): #{verb.upcase} /#{endpoint}/ - Payload: #{loggable_payload(payload)}")
    raise Error, "Request to endpoint /#{endpoint} timed out after #{timeout} seconds"
  rescue Faraday::Error => e
    LogService.log(:error, "KnowledgeService", "Network error: #{verb.upcase} /#{endpoint}/ - #{e.class}: #{e.message}")
    raise Error, "Network error for endpoint /#{endpoint}: #{e.message}"
  end
end
