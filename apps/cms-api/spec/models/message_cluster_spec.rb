require "rails_helper"

RSpec.describe MessageCluster, type: :model do
  let(:hub) { create(:hub) }
  let(:conversation) { create(:conversation, hub: hub) }
  let(:cluster) { create(:message_cluster, hub: hub) }

  describe "last_replied_external_message" do
    it "returns the most recent external message with a bot reply" do
      older = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: 2.minutes.ago)
      create(:message, :outgoing, conversation: conversation, reply_to: older)
      newer = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: 1.minute.ago)
      create(:message, :outgoing, conversation: conversation, reply_to: newer)

      expect(cluster.last_replied_external_message).to eq(newer)
    end

    it "excludes internal messages even if more recent" do
      external = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: 2.minutes.ago)
      create(:message, :outgoing, conversation: conversation, reply_to: external)
      internal = create(:message, :incoming, conversation: conversation, message_cluster: cluster, created_at: 1.minute.ago)
      create(:message, :outgoing, conversation: conversation, reply_to: internal)

      expect(cluster.last_replied_external_message).to eq(external)
    end

    it "returns nil when the cluster has no external messages with bot replies" do
      expect(cluster.last_replied_external_message).to be_nil
    end

    it "skips messages in soft-deleted conversations" do
      deleted = create(:conversation, hub: hub)
      live_question = ask_clustered_question(conversation, cluster, answered: true, created_at: 2.minutes.ago)
      ask_clustered_question(deleted, cluster, answered: true, created_at: 1.minute.ago)
      deleted.update!(deleted_at: Time.current)

      expect(cluster.last_replied_external_message).to eq(live_question)
    end
  end

  describe ".with_last_external_message_answered" do
    it "includes clusters whose last message bot reply is answered" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: true)

      expect(MessageCluster.with_last_external_message_answered(true)).to include(cluster)
    end

    it "excludes clusters whose last message bot reply does not match" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: false)

      expect(MessageCluster.with_last_external_message_answered(true)).not_to include(cluster)
    end

    it "uses the last message to determine the bucket for mixed clusters" do
      answered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: answered_incoming, answered: true)
      unanswered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: unanswered_incoming, answered: false)

      expect(MessageCluster.with_last_external_message_answered(true)).not_to include(cluster)
      expect(MessageCluster.with_last_external_message_answered(false)).to include(cluster)
    end
  end

  describe "#as_json" do
    it "does not include centroid_embedding" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: incoming)

      expect(cluster.as_json).not_to have_key("centroid_embedding")
    end

    it "includes last_message_body from the last replied external message" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, body: "what is love")
      create(:message, :outgoing, conversation: conversation, reply_to: incoming)

      expect(cluster.as_json["last_message_body"]).to eq("what is love")
    end

    it "includes last_message_answered_status from the last replied external message's bot reply" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: true)

      expect(cluster.as_json["last_message_answered_status"]).to eq(true)
    end

    it "counts only messages matching the last replied message's answered status" do
      3.times do
        incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: 2.minutes.ago)
        create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: true)
      end
      2.times do
        incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: 1.minute.ago)
        create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: false)
      end

      result = cluster.as_json
      expect(result["last_message_answered_status"]).to eq(false)
      expect(result["current_answered_status_count"]).to eq(2)
    end

    it "ignores questions in soft-deleted conversations" do
      deleted = create(:conversation, hub: hub)
      ask_clustered_question(conversation, cluster, answered: false, body: "live question", created_at: 3.minutes.ago)
      2.times { ask_clustered_question(deleted, cluster, answered: true, body: "deleted question", created_at: 1.minute.ago) }
      deleted.update!(deleted_at: Time.current)

      result = cluster.as_json

      expect(result["last_message_body"]).to eq("live question")
      expect(result["last_message_answered_status"]).to eq(false)
      expect(result["current_answered_status_count"]).to eq(1)
    end

    it "returns a nil count when the last reply has an unknown answered status" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, reply_to: incoming, answered: nil)

      result = cluster.as_json

      expect(result).to include("last_message_answered_status" => nil, "current_answered_status_count" => nil)
    end

    it "falls back to original_text when there is no replied external message" do
      result = cluster.as_json

      expect(result).to include("last_message_body" => cluster.original_text, "last_message_answered_status" => nil, "current_answered_status_count" => nil)
    end
  end

  describe "#questions_ranking_payload" do
    it "includes last_message_body from the last external replied message" do
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, body: "what is love")
      create(:message, :outgoing, conversation: conversation, reply_to: incoming)

      expect(cluster.questions_ranking_payload[:last_message_body]).to eq("what is love")
    end

    it "returns nil for last_message_body when the cluster has no external messages with bot replies" do
      expect(cluster.questions_ranking_payload[:last_message_body]).to be_nil
    end
  end

  describe "vector embedding" do
    it "stores and retrieves vector embeddings as arrays" do
      embedding = Array.new(1024, 0.5)
      cluster = create(:message_cluster, centroid_embedding: embedding)

      cluster.reload
      expect(cluster.centroid_embedding).to be_an(Array)
      expect(cluster.centroid_embedding.size).to eq(1024)
      expect(cluster.centroid_embedding.first).to eq(0.5)
    end

    it "handles different vector values" do
      embedding = (1..1024).to_a.map { |i| i * 0.001 }
      cluster = create(:message_cluster, centroid_embedding: embedding)

      cluster.reload
      expect(cluster.centroid_embedding.size).to eq(1024)
      expect(cluster.centroid_embedding[0]).to be_within(0.0001).of(0.001)
      expect(cluster.centroid_embedding[100]).to be_within(0.0001).of(0.101)
      expect(cluster.centroid_embedding[1023]).to be_within(0.0001).of(1.024)
    end
  end

  describe ".without_live_messages" do
    it "includes a cluster whose messages are all in soft-deleted conversations" do
      deleted = create(:conversation, hub: hub)
      orphan = create(:message_cluster, hub: hub)
      create(:message, :incoming, conversation: deleted, message_cluster: orphan)
      deleted.update!(deleted_at: Time.current)

      expect(MessageCluster.without_live_messages).to include(orphan)
    end

    it "includes a cluster with no messages" do
      empty = create(:message_cluster, hub: hub)

      expect(MessageCluster.without_live_messages).to include(empty)
    end

    it "excludes a cluster with a message in a live conversation" do
      create(:message, :incoming, conversation: conversation, message_cluster: cluster)

      expect(MessageCluster.without_live_messages).not_to include(cluster)
    end

    it "still works when other messages belong to no cluster" do
      create(:message, :incoming, conversation: conversation, message_cluster: nil)
      empty = create(:message_cluster, hub: hub)

      expect(MessageCluster.without_live_messages).to include(empty)
    end
  end

  describe "#reset_ai_summary" do
    it "clears ai_summary when original_text changes" do
      cluster.update_columns(ai_summary: "What is climate change?")

      cluster.update!(original_text: "Is the sea level rising?")

      expect(cluster.reload.ai_summary).to be_nil
    end

    it "keeps ai_summary when original_text is unchanged" do
      cluster.update_columns(ai_summary: "What is climate change?")

      cluster.update!(question_count: 5)

      expect(cluster.reload.ai_summary).to eq("What is climate change?")
    end
  end

  describe "#resummarize_in_notebooks" do
    it "enqueues ItemSummaryWorker for each notebook holding the cluster when original_text changes" do
      notebook_a = create(:notebook, hub: hub)
      notebook_b = create(:notebook, hub: hub)
      create(:notebook_item, notebook: notebook_a, item: cluster)
      create(:notebook_item, notebook: notebook_b, item: cluster)
      allow(ItemSummaryWorker).to receive(:perform_async)

      cluster.update!(original_text: "Is the sea level rising?")

      expect(ItemSummaryWorker).to have_received(:perform_async).with("MessageCluster", cluster.id, notebook_a.id)
      expect(ItemSummaryWorker).to have_received(:perform_async).with("MessageCluster", cluster.id, notebook_b.id)
    end

    it "marks each notebook holding the cluster as awaiting a summary update" do
      notebook = create(:notebook, hub: hub)
      create(:notebook_item, notebook: notebook, item: cluster)
      notebook.update_column(:ai_summary_update_requested_at, nil)

      cluster.update!(original_text: "Is the sea level rising?")

      expect(notebook.reload.ai_summary_update_requested_at).to be_present
    end

    it "does nothing when original_text is unchanged" do
      create(:notebook_item, notebook: create(:notebook, hub: hub), item: cluster)
      allow(ItemSummaryWorker).to receive(:perform_async)

      cluster.update!(question_count: 5)

      expect(ItemSummaryWorker).not_to have_received(:perform_async)
    end
  end

  it "can be a notebook item" do
    hub = create(:hub)
    message_cluster = create(:message_cluster, hub: hub)
    notebook = create(:notebook, hub: hub)
    notebook.message_clusters << message_cluster
    expect(message_cluster.reload.notebooks.to_a).to eq([notebook])
  end

  it "has text for summarization" do
    message_cluster = create(:message_cluster)
    expect(message_cluster.text_for_summarization).not_to be(nil)
  end
end
