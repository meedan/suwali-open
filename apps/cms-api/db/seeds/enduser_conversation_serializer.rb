# Turns sampled records into snapshot rows: pgvector columns dropped, and Anonymizable fields
# replaced with the sentinel EnduserConversationMasker later swaps for a consistent fake identity.
class EnduserConversationSerializer
  # Knowledge Service debug output that nothing reads back, but that dominates the snapshot file size.
  DISCARDED_MESSAGE_METADATA = %w[entities retrieved_chunks].freeze

  def initialize(sampler)
    @sampler = sampler
  end

  def as_snapshot
    {
      "external_users" => anonymized_rows(sampler.external_users),
      "conversations" => anonymized_rows(sampler.conversations),
      "messages" => sampler.messages.map { |message| discard_debug_metadata(anonymized_row(message)) },
      "topics" => rows(sampler.topics),
      "topic_items" => rows(sampler.topic_items),
      "message_data_source_items" => rows(sampler.data_source_items),
      "contributions" => rows(sampler.contributions)
    }
  end

  private

  attr_reader :sampler

  def rows(records)
    records.map { |record| row(record) }
  end

  def anonymized_rows(records)
    records.map { |record| anonymized_row(record) }
  end

  def anonymized_row(record)
    row(record).merge(record.anonymized_attributes)
  end

  # Embeddings are enormous and nothing reads them back out of a snapshot.
  def row(record)
    record.attributes.reject { |column, _| record.class.columns_hash[column]&.sql_type&.start_with?("vector") }
  end

  def discard_debug_metadata(row)
    row.merge("metadata" => row["metadata"].except(*DISCARDED_MESSAGE_METADATA))
  end
end
