require "rails_helper"

RSpec.describe KnowledgeServiceWorker, type: :worker do
  let(:document) { create(:document) }
  let(:published_notebook) { create(:notebook, published: true, summary: "Notebook Summary") }
  let(:unpublished_notebook) { create(:notebook, published: false, summary: "Notebook Summary") }
  let(:pdf_document) { create(:document, :with_pdf) }
  let(:incoming_message) { create(:message, direction: "incoming") }
  let(:outgoing_message) { create(:message, direction: "outgoing") }
  let(:contribution) { create(:contribution, content: "Contribution Content") }

  describe "#perform for :ingest_document" do
    it "calls KnowledgeService.ingest_document when there is a file" do
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(pdf_document.source.hub_id, Base64.encode64("Document/#{pdf_document.id}"), a_string_including("/rails/active_storage/blobs/proxy/"), nil, nil, nil, pdf_document.priority_tier, [], false, "document", nil)
      described_class.new.perform("ingest_document", pdf_document.id)
    end

    it "does not use the published_at metadata when the column is nil" do
      dated_document = create(:document, :with_pdf, metadata: {published_at: "2024-01-01T10:00:00Z"})
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(dated_document.source.hub_id, Base64.encode64("Document/#{dated_document.id}"), a_string_including("/rails/active_storage/blobs/proxy/"), nil, nil, nil, dated_document.priority_tier, [], false, "document", nil)
      described_class.new.perform("ingest_document", dated_document.id)
    end

    it "passes the published_at column to KnowledgeService as ISO 8601" do
      dated_document = create(:document, :with_pdf, published_at: Time.utc(2024, 1, 1, 10))
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(dated_document.source.hub_id, anything, anything, nil, nil, "2024-01-01T10:00:00Z", dated_document.priority_tier, [], false, "document", nil)
      described_class.new.perform("ingest_document", dated_document.id)
    end

    it "prefers the published_at column over the metadata date" do
      dated_document = create(:document, :with_pdf, published_at: Time.utc(2024, 1, 1, 10), metadata: {published_at: "2020-05-05T05:00:00Z"})
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(dated_document.source.hub_id, anything, anything, nil, nil, "2024-01-01T10:00:00Z", dated_document.priority_tier, [], false, "document", nil)
      described_class.new.perform("ingest_document", dated_document.id)
    end

    it "passes the hub's existing topic names to KnowledgeService" do
      pdf_document.source.hub.topics.create!(name: "Climate")
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(pdf_document.source.hub_id, anything, anything, nil, nil, nil, pdf_document.priority_tier, ["Climate"], false, "document", nil)
      described_class.new.perform("ingest_document", pdf_document.id)
    end

    it "passes the summary written by a user, not the AI summary, to KnowledgeService" do
      pdf_document.update_columns(summary: "User summary", ai_summary: "AI summary")
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      expect(KnowledgeService).to receive(:ingest).with(pdf_document.source.hub_id, anything, anything, nil, nil, nil, pdf_document.priority_tier, [], false, "document", "User summary")
      described_class.new.perform("ingest_document", pdf_document.id)
    end

    it "doesn't call KnowledgeService.ingest_document when there is no file" do
      expect(KnowledgeService).not_to receive(:ingest).with(document.source.hub_id, document.file.url)
      described_class.new.perform("ingest_document", document.id)
    end
  end

  describe "#perform for :delete_document" do
    it "calls KnowledgeService.delete_document" do
      expect(KnowledgeService).to receive(:delete).with(document.source.hub_id, Base64.encode64("Document/#{document.id}"))
      described_class.new.perform("delete_document", document.id, document.source.hub_id)
    end
  end

  describe "#perform for :ingest_notebook_summary" do
    it "calls KnowledgeService.ingest_notebook_summary when notebook is published" do
      expect(KnowledgeService).to receive(:ingest).with(published_notebook.hub_id, Base64.encode64("Notebook/#{published_notebook.id}"), nil, "Notebook Summary", nil, nil, published_notebook.priority_tier, [], true, "notebook")
      described_class.new.perform("ingest_notebook_summary", published_notebook.id)
    end

    it "doesn't call KnowledgeService.ingest_notebook_summary when notebook is not published" do
      expect(KnowledgeService).not_to receive(:ingest).with(unpublished_notebook.hub_id, Base64.encode64("Notebook/#{unpublished_notebook.id}"), nil, "Notebook Summary")
      described_class.new.perform("ingest_notebook_summary", unpublished_notebook.id)
    end
  end

  describe "#perform for :ingest_community_knowledge" do
    it "calls KnowledgeService.ingest_community_knowledge when contribution is created" do
      expect(KnowledgeService).to receive(:ingest).with(contribution.hub_id, Base64.encode64("Contribution/#{contribution.id}"), nil, "Contribution Content", nil, nil, contribution.priority_tier, [], false, "contribution")
      described_class.new.perform("ingest_community_knowledge", contribution.id)
    end
  end

  describe "#perform for :extract_community_knowledge_topics" do
    it "extracts topics from the contribution content and assigns them" do
      paused_contribution = create(:contribution, content: "Contribution Content", hub: create(:hub, contribution_workflow_mode: :review))
      paused_contribution.hub.topics.create!(name: "Climate")

      expect(KnowledgeService).to receive(:extract_topics)
        .with(paused_contribution.hub_id, Base64.encode64("Contribution/#{paused_contribution.id}"), ["Climate"], "Contribution Content")
        .and_return(["Climate", "Elections"])

      described_class.new.perform("extract_community_knowledge_topics", paused_contribution.id)

      expect(paused_contribution.reload.topics.map(&:name)).to match_array(["Climate", "Elections"])
    end
  end

  describe "#perform for :sync_topics" do
    def stub_update_topics
      allow(KnowledgeService).to receive(:update_topics)
    end

    it "sends the item's topics, suggested and user-added but not removed, to the Knowledge Service" do
      stub_update_topics
      user = create(:user)
      contribution.assign_topic_names(["Climate", "Elections"])
      contribution.update_columns(sync_status: :complete)
      contribution.hub.topics.create!(name: "Housing").topic_items.create!(item: contribution, added_by: user)
      contribution.topic_items.joins(:topic).find_by(topics: {name: "Elections"}).destroy!

      described_class.new.perform("sync_topics", "Contribution/#{contribution.id}")

      expect(KnowledgeService).to have_received(:update_topics)
        .with(contribution.hub_id, Base64.encode64("Contribution/#{contribution.id}"), match_array(["Climate", "Housing"]))
    end

    it "sends a document's topics" do
      stub_update_topics
      document.update_columns(sync_status: :complete)

      described_class.new.perform("sync_topics", "Document/#{document.id}")

      expect(KnowledgeService).to have_received(:update_topics).with(document.hub.id, Base64.encode64("Document/#{document.id}"), [])
    end

    it "sends a notebook's topics" do
      stub_update_topics
      published_notebook.update_columns(sync_status: :complete)

      described_class.new.perform("sync_topics", "Notebook/#{published_notebook.id}")

      expect(KnowledgeService).to have_received(:update_topics).with(published_notebook.hub.id, Base64.encode64("Notebook/#{published_notebook.id}"), [])
    end

    it "does nothing when the item is no longer synced" do
      stub_update_topics
      contribution.update_columns(sync_status: :pending)

      described_class.new.perform("sync_topics", "Contribution/#{contribution.id}")

      expect(KnowledgeService).not_to have_received(:update_topics)
    end

    it "does nothing when the item no longer exists" do
      stub_update_topics

      described_class.new.perform("sync_topics", "Contribution/0")

      expect(KnowledgeService).not_to have_received(:update_topics)
    end

    it "does nothing for a class that is not syncable" do
      stub_update_topics

      described_class.new.perform("sync_topics", "User/#{create(:user).id}")

      expect(KnowledgeService).not_to have_received(:update_topics)
    end

    it "lets the next change to the topics enqueue a new sync when the item was not synced" do
      stub_update_topics
      use_memory_cache
      contribution.update_columns(sync_status: :complete)
      contribution.sync_topics_to_knowledge_service
      contribution.update_columns(sync_status: :pending)

      described_class.new.perform("sync_topics", "Contribution/#{contribution.id}")

      contribution.update_columns(sync_status: :complete)
      expect { contribution.sync_topics_to_knowledge_service }.to change { sync_topics_jobs.size }.by(1)
    end

    it "enqueues a new sync for a change made while the topics are being sent" do
      use_memory_cache
      contribution.update_columns(sync_status: :complete)
      contribution.sync_topics_to_knowledge_service
      allow(KnowledgeService).to receive(:update_topics) { contribution.sync_topics_to_knowledge_service }

      expect {
        described_class.new.perform("sync_topics", "Contribution/#{contribution.id}")
      }.to change { sync_topics_jobs.size }.by(1)
    end
  end

  describe "#perform for :delete_community_knowledge" do
    it "calls KnowledgeService.delete_community_knowledge when contribution is deleted" do
      expect(KnowledgeService).to receive(:delete).with(contribution.hub_id, Base64.encode64("Contribution/#{contribution.id}"))
      described_class.new.perform("delete_community_knowledge", contribution.id, contribution.hub_id)
    end
  end

  describe "#perform for :delete_notebook_summary" do
    it "calls KnowledgeService.delete_notebook_summary when notebook is unpublished" do
      expect(KnowledgeService).to receive(:delete).with(unpublished_notebook.hub_id, Base64.encode64("Notebook/#{unpublished_notebook.id}"))
      described_class.new.perform("delete_notebook_summary", unpublished_notebook.id, unpublished_notebook.hub_id)
    end

    it "doesn't call KnowledgeService.delete_notebook_summary when notebook is published" do
      expect(KnowledgeService).not_to receive(:delete).with(published_notebook.hub_id, Base64.encode64("Notebook/#{published_notebook.id}"))
      described_class.new.perform("delete_notebook_summary", published_notebook.id)
    end
  end

  describe "#perform for :chat" do
    it "calls KnowledgeService.chat when message is incoming" do
      expect(KnowledgeService).to receive(:chat).with(
        incoming_message.conversation.hub_id,
        incoming_message.id,
        incoming_message.body,
        anything,
        anything,
        anything,
        anything,
        anything,
        anything
      )

      described_class.new.perform("chat", incoming_message.id)
    end

    it "sends the hub's existing topics so the Knowledge Service can avoid near-duplicates" do
      hub = incoming_message.conversation.hub
      hub.topics.create!(name: "Climate")
      hub.topics.create!(name: "Elections")

      expect(KnowledgeService).to receive(:chat) do |*args|
        expect(args[6]).to match_array(["Climate", "Elections"])
      end

      described_class.new.perform("chat", incoming_message.id)
    end

    it "sends the conversation context" do
      conversation = incoming_message.conversation
      conversation.update!(context: [{"id" => "n1", "text" => "Lives in Nairobi", "message_id" => 1, "created_at" => "2026-10-12T00:00:00Z"}])

      expect(KnowledgeService).to receive(:chat) { |*args| expect(args[7]).to eq([{"id" => "n1", "text" => "Lives in Nairobi"}]) }
      described_class.new.perform("chat", incoming_message.id)
    end

    it "does not create outgoing messages (answer arrives via callback)" do
      allow(KnowledgeService).to receive(:chat)

      expect {
        described_class.new.perform("chat", incoming_message.id)
      }.not_to change { incoming_message.conversation.messages.outgoing.count }
    end

    it "doesn't call KnowledgeService.chat when message is outgoing" do
      expect(KnowledgeService).not_to receive(:chat)
      described_class.new.perform("chat", outgoing_message.id)
    end

    it "sends personalization data when bot_attributes are present" do
      hub = create(:hub, bot_attributes: {name: "KnowledgeBot", tone: "friendly"})
      create(:external_resource, hub: hub, scenarios: ["role_description"])
      message = create(:message, direction: "incoming", conversation: create(:conversation, hub: hub))

      expect(KnowledgeService).to receive(:chat) do |hub_id, message_id, body, history, personalization, recency_first_enabled|
        expect(hub_id).to eq(hub.id)
        expect(personalization[:name]).to eq("KnowledgeBot")
      end

      described_class.new.perform("chat", message.id)
    end

    it "sends the hub's location gate flag with the conversation context" do
      hub = create(:hub, allowed_features: {"LOCATION_GATE" => true})
      message = create(:message, direction: "incoming", conversation: create(:conversation, hub: hub))

      expect(KnowledgeService).to receive(:chat) do |*args|
        expect(args[7]).to eq([])
        expect(args[8]).to be(true)
      end

      described_class.new.perform("chat", message.id)
    end

    it "sends the location gate flag off for a hub without the feature" do
      expect(KnowledgeService).to receive(:chat) do |*args|
        expect(args[8]).to be(false)
      end

      described_class.new.perform("chat", incoming_message.id)
    end
  end

  describe "#perform with invalid operation" do
    it "does nothing for unknown operation" do
      expect { described_class.new.perform("invalid", 1) }.not_to raise_error
    end
  end

  describe "#perform with error" do
    it "raises for error" do
      expect { described_class.new.perform("ingest_document", 0) }.to raise_error(ActiveRecord::RecordNotFound)
    end
  end

  describe "metrics" do
    it "does not publish metrics from worker (metrics now tracked via callbacks)" do
      allow(KnowledgeService).to receive(:delete)
      expect(MetricsService).not_to receive(:new)
      described_class.new.perform("delete_document", document.id, document.source.hub_id)
    end
  end

  describe "sidekiq_retries_exhausted callback" do
    it "logs when retries are exhausted for non-chat operations" do
      msg = {
        "args" => ["ingest_document", 123],
        "jid" => "abc123"
      }

      expect(LogService).to receive(:log).with(:error, "KnowledgeServiceWorker", /Retries exhausted after 3 attempts - Operation: ingest_document, ID: 123, Job ID: abc123/)

      described_class.sidekiq_retries_exhausted_block.call(msg, StandardError.new("Error"))
    end

    it "creates error message and releases rate limiter for chat operations" do
      msg = {
        "args" => ["chat", incoming_message.id],
        "jid" => "abc123"
      }

      expect {
        described_class.sidekiq_retries_exhausted_block.call(msg, StandardError.new("Error"))
      }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)

      error_msg = incoming_message.conversation.messages.outgoing.last
      expect(error_msg.body).to eq(I18n.t(:error_create_chat_response_message))
      expect(error_msg.state).to eq("knowledge_service_error")
      expect(error_msg.reply_to).to eq(incoming_message)
    end
  end
end
