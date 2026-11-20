# Hub Deletion Verification Script
# Usage in Rails console:
#   load 'scripts/verify_hub_deletion.rb'
#   verify_hub_deletion(123)  # Replace 123 with the deleted hub_id

def verify_hub_deletion(hub_id)
  puts "=" * 80
  puts "VERIFYING COMPLETE DELETION FOR HUB ID: #{hub_id}"
  puts "=" * 80
  puts

  results = {}
  total_orphaned = 0

  # Check if hub still exists
  hub_exists = Hub.exists?(hub_id)
  results[:hub_exists] = hub_exists

  if hub_exists
    puts "❌ FAILED: Hub #{hub_id} still exists in database!"
    puts
    return results
  else
    puts "✓ Hub #{hub_id} successfully deleted from database"
    puts
  end

  # CATEGORY 1: Direct Hub Relationships
  puts "CATEGORY 1: Direct Hub Relationships"
  puts "-" * 80

  checks = {
    "HubMembership" => HubMembership.where(hub_id: hub_id),
    "Source" => Source.where(hub_id: hub_id),
    "Notebook" => Notebook.where(hub_id: hub_id),
    "Conversation" => Conversation.where(hub_id: hub_id),
    "Contribution" => Contribution.where(hub_id: hub_id),
    "MessagingIntegration" => MessagingIntegration.where(hub_id: hub_id),
    "ExternalUser" => ExternalUser.where(hub_id: hub_id),
    "ExternalResource" => ExternalResource.where(hub_id: hub_id)
  }

  checks.each do |model_name, query|
    count = query.count
    results[model_name.underscore.to_sym] = count
    total_orphaned += count

    if count > 0
      puts "❌ #{model_name}: #{count} orphaned record(s) found"
      puts "   IDs: #{query.pluck(:id).join(", ")}"
    else
      puts "✓ #{model_name}: 0 records (clean)"
    end
  end
  puts

  # CATEGORY 2: Indirect Through Source
  puts "CATEGORY 2: Indirect Relationships Through Source"
  puts "-" * 80

  document_count = Document.joins(:source).where(sources: {hub_id: hub_id}).count
  results[:document] = document_count
  total_orphaned += document_count

  if document_count > 0
    puts "❌ Document: #{document_count} orphaned record(s) found"
    puts "   IDs: #{Document.joins(:source).where(sources: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ Document: 0 records (clean)"
  end

  deleted_doc_count = DeletedDocument.joins(:source).where(sources: {hub_id: hub_id}).count
  results[:deleted_document] = deleted_doc_count
  total_orphaned += deleted_doc_count

  if deleted_doc_count > 0
    puts "❌ DeletedDocument: #{deleted_doc_count} orphaned record(s) found"
    puts "   IDs: #{DeletedDocument.joins(:source).where(sources: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ DeletedDocument: 0 records (clean)"
  end
  puts

  # CATEGORY 3: Indirect Through Notebook
  puts "CATEGORY 3: Indirect Relationships Through Notebook"
  puts "-" * 80

  note_count = Note.joins(:notebook).where(notebooks: {hub_id: hub_id}).count
  results[:note] = note_count
  total_orphaned += note_count

  if note_count > 0
    puts "❌ Note: #{note_count} orphaned record(s) found"
    puts "   IDs: #{Note.joins(:notebook).where(notebooks: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ Note: 0 records (clean)"
  end

  notebook_item_count = NotebookItem.joins(:notebook).where(notebooks: {hub_id: hub_id}).count
  results[:notebook_item] = notebook_item_count
  total_orphaned += notebook_item_count

  if notebook_item_count > 0
    puts "❌ NotebookItem: #{notebook_item_count} orphaned record(s) found"
    puts "   IDs: #{NotebookItem.joins(:notebook).where(notebooks: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ NotebookItem: 0 records (clean)"
  end
  puts

  # CATEGORY 4: Indirect Through Conversation
  puts "CATEGORY 4: Indirect Relationships Through Conversation"
  puts "-" * 80

  message_count = Message.joins(:conversation).where(conversations: {hub_id: hub_id}).count
  results[:message] = message_count
  total_orphaned += message_count

  if message_count > 0
    puts "❌ Message: #{message_count} orphaned record(s) found"
    puts "   IDs: #{Message.joins(:conversation).where(conversations: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ Message: 0 records (clean)"
  end

  message_report_count = MessageReport.joins(message: :conversation).where(conversations: {hub_id: hub_id}).count
  results[:message_report] = message_report_count
  total_orphaned += message_report_count

  if message_report_count > 0
    puts "❌ MessageReport: #{message_report_count} orphaned record(s) found"
    puts "   IDs: #{MessageReport.joins(message: :conversation).where(conversations: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ MessageReport: 0 records (clean)"
  end

  message_data_source_item_count = MessageDataSourceItem.joins(message: :conversation).where(conversations: {hub_id: hub_id}).count
  results[:message_data_source_item] = message_data_source_item_count
  total_orphaned += message_data_source_item_count

  if message_data_source_item_count > 0
    puts "❌ MessageDataSourceItem: #{message_data_source_item_count} orphaned record(s) found"
    puts "   IDs: #{MessageDataSourceItem.joins(message: :conversation).where(conversations: {hub_id: hub_id}).pluck(:id).join(", ")}"
  else
    puts "✓ MessageDataSourceItem: 0 records (clean)"
  end
  puts

  # SUMMARY
  puts "=" * 80
  puts "SUMMARY"
  puts "=" * 80
  puts "Total orphaned records found: #{total_orphaned}"
  puts

  if total_orphaned == 0
    puts "✓✓✓ SUCCESS: All data for hub #{hub_id} has been completely deleted! ✓✓✓"
  else
    puts "❌❌❌ FAILURE: Found #{total_orphaned} orphaned record(s) for hub #{hub_id} ❌❌❌"
    puts
    puts "Models with orphaned data:"
    results.each do |model, count|
      next if count == 0 || model == :hub_exists
      puts "  - #{model}: #{count} record(s)"
    end
  end
  puts "=" * 80
  puts

  results
end

# Alternative: Quick check (returns true if clean, false if orphaned data found)
def hub_deletion_clean?(hub_id)
  return false if Hub.exists?(hub_id)

  [
    HubMembership.where(hub_id: hub_id),
    Source.where(hub_id: hub_id),
    Notebook.where(hub_id: hub_id),
    Conversation.where(hub_id: hub_id),
    Contribution.where(hub_id: hub_id),
    MessagingIntegration.where(hub_id: hub_id),
    ExternalUser.where(hub_id: hub_id),
    ExternalResource.where(hub_id: hub_id),
    Document.joins(:source).where(sources: {hub_id: hub_id}),
    DeletedDocument.joins(:source).where(sources: {hub_id: hub_id}),
    Note.joins(:notebook).where(notebooks: {hub_id: hub_id}),
    NotebookItem.joins(:notebook).where(notebooks: {hub_id: hub_id}),
    Message.joins(:conversation).where(conversations: {hub_id: hub_id}),
    MessageReport.joins(message: :conversation).where(conversations: {hub_id: hub_id}),
    MessageDataSourceItem.joins(message: :conversation).where(conversations: {hub_id: hub_id})
  ].all? { |query| query.count == 0 }
end

puts "Hub deletion verification script loaded!"
puts
puts "Usage:"
puts "  verify_hub_deletion(123)     # Full detailed report"
puts "  hub_deletion_clean?(123)     # Quick boolean check"
puts
