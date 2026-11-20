class ConversationCsvExporter
  MAX_MESSAGES = 10_000
  HEADERS = %w[convo_id user_id user_type platform message_id sender timestamp message answered reply_to_id context
    cited_sources document_ids_used retrieved_chunks].freeze
  SENDERS = {"incoming" => "human", "outgoing" => "bot"}.freeze
  USER_TYPES = {"User" => "HubUser", "ExternalUser" => "ExternalUser"}.freeze

  def initialize(conversations)
    @conversations = conversations
  end

  def generate
    CsvExporter.generate(headers: HEADERS) { |csv| add_rows(csv) }
  end

  def write(io)
    CsvExporter.write(io, headers: HEADERS) { |csv| add_rows(csv) }
  end

  private

  def add_rows(csv)
    @conversations.each do |conversation|
      latest_messages(conversation).each { |message| csv << row(conversation, message) }
    end
  end

  def latest_messages(conversation)
    conversation.messages.order(id: :desc).limit(MAX_MESSAGES).preload(:message_data_source_items).reverse
  end

  def row(conversation, message)
    metadata = message.metadata.to_h
    [
      conversation.id,
      conversation.participant_id,
      USER_TYPES[conversation.participant_type],
      conversation.platform,
      message.id,
      SENDERS[message.direction],
      message.created_at.utc.iso8601,
      message.body,
      message.answered,
      message.reply_to_id,
      (metadata["context_updates"] || []).to_json,
      cited_sources(message).to_json,
      (metadata["document_ids_used"] || []).to_json,
      (metadata["retrieved_chunks"] || []).to_json
    ]
  end

  def cited_sources(message)
    message.message_data_source_items.map { |item| item.data_source_payload.slice(:type, :id, :title) }
  end
end
