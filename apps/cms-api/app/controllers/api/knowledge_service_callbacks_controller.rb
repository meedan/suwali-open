class Api::KnowledgeServiceCallbacksController < ApplicationController
  before_action :validate_token!
  before_action :decode_and_validate_id!, only: [:update_sync_status]

  def update_sync_status
    status = ActiveRecord::Type::Boolean.new.cast(params[:success]) ? :complete : :error

    if status == :complete && @record.hub.present?
      duration_ms = ((Time.current - @record.updated_at) * 1000).round
      MetricsService.new(hub_id: @record.hub.id).publish_metric("data_source_item.synced", duration_ms, unit: "Milliseconds")
    end

    @record.update_columns(sync_status: status, last_sync_error_code: (status == :error) ? params[:error_code] : nil)

    @record.assign_topic_names(params[:topics]) if status == :complete
    @record.try(:retry_item_summary_generation)
    @record.sync_topics_to_knowledge_service if status == :complete

    head :ok
  end

  def update_chat_status
    message = Message.find_by(id: params[:message_id])
    return head :not_found unless message

    begin
      body = JSON.parse(request.body.read)
    rescue JSON::ParserError
      return head :bad_request
    end

    status = body["status"]
    payload = body["payload"]

    case status
    when "complete"
      handle_chat_complete(message, payload)
    when "error"
      handle_chat_error(message)
    else
      handle_intermediary_status(message, status, payload)
    end

    head :ok
  end

  private

  INTERMEDIARY_STATUSES = %w[parsing_question searching_sources evaluating_results].freeze

  def validate_token!
    unless params[:token].present? && ActiveSupport::SecurityUtils.secure_compare(params[:token].to_s, ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"].to_s)
      render json: {error: I18n.t(:error_permission)}, status: :unauthorized
    end
  end

  def decode_and_validate_id!
    unless params[:id].present?
      render json: {error: I18n.t(:error_unsupported_id)}, status: :unprocessable_content
      return
    end

    decoded = Base64.decode64(params[:id])
    class_name, record_id = decoded.split("/")

    unless ["Document", "Notebook", "Contribution"].include?(class_name)
      render json: {error: I18n.t(:error_unsupported_id)}, status: :unprocessable_content
      return
    end

    # nosemgrep: ruby.rails.security.brakeman.check-unsafe-reflection.check-unsafe-reflection -- class_name is checked against a literal allowlist above
    @record = class_name.constantize.find_by(id: record_id)

    unless @record
      render json: {error: I18n.t(:error_not_found)}, status: :not_found
    end
  end

  def handle_intermediary_status(message, status, payload = nil)
    return unless INTERMEDIARY_STATUSES.include?(status)
    # Don't create intermediary if answer already delivered
    return if message.reply.present?

    message.conversation.update_language(payload["language"]) if payload.is_a?(Hash)

    # The "evaluating_results" status only happens when processing is taking longer than
    # expected, so it's important to be informative and send an actual message on all
    # platforms. For the earlier statuses, refresh the free typing indicator, if available.
    unless status == "evaluating_results"
      TypingIndicatorWorker.perform_async(message.id) if TypingIndicatorWorker.supports?(message.conversation)
      return
    end

    message.conversation.messages.create!(
      direction: "outgoing",
      body: message.intermediary_message_text(status),
      state: :bot_intermediary_message,
      metadata: {"step" => status}
    )
  end

  def handle_chat_complete(message, payload)
    # Idempotency: don't create duplicate answers from retry callbacks
    return if message.reply.present?
    conversation = message.conversation

    answer = payload["answer"]
    metadata = payload["metadata"] || {}
    error_type = payload["error_type"]
    language = metadata.to_h["language"]
    conversation.update_language(language)

    answered = if metadata["answerable"] == true
      error_type.nil?
    end

    state = if error_type
      :knowledge_service_error
    elsif %w[non_question location_noted].include?(metadata["router_intent"])
      :non_question_reply
    end

    begin
      conversation.messages.create!(
        direction: "outgoing",
        body: answer,
        metadata: metadata.merge({"error_type" => error_type}),
        state: state,
        reply_to: message,
        answered: answered
      )
    rescue => e
      create_error_message(message, {answered: answered})
      LogService.log(:error, "KnowledgeServiceCallbacksController", "Error creating chat response: #{e.message}")
    end

    # Store the topics the Knowledge Service extracted from the question on the incoming message
    message.assign_topic_names(payload["topics"])

    begin
      conversation.apply_context_updates!(payload["context_updates"], message)
    rescue => e
      LogService.log(:error, "KnowledgeServiceCallbacksController", "Error applying context updates to conversation #{conversation.id}: #{e.message}")
    end

    # Release the conversation rate limit lock after answer is created
    release_rate_limit(message)

    # Publish end-to-end answer time metric (from incoming message created_at until complete callback)
    duration_ms = ((Time.current - message.created_at) * 1000).round
    MetricsService.new(hub_id: message.conversation.hub_id).publish_metric("answer.generated", duration_ms, unit: "Milliseconds")
  end

  def handle_chat_error(message)
    return if message.reply.present?

    create_error_message(message)
    release_rate_limit(message)
  end

  def create_error_message(message, extra = {})
    conversation = message.conversation
    conversation.messages.create!({
      direction: "outgoing",
      body: I18n.with_locale(conversation.language) { I18n.t(:error_create_chat_response_message) },
      state: :knowledge_service_error,
      reply_to: message
    }.merge(extra))
  end

  def release_rate_limit(message)
    limiter = ConversationRateLimiter.new(message.conversation)
    limiter.release!
  end
end
