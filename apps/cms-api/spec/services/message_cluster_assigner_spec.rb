require "rails_helper"

RSpec.describe MessageClusterAssigner, type: :service do
  let(:conversation) { create(:conversation) }
  let(:embedding_trump) { Array.new(512, 1.0) + Array.new(512, 0.0) }
  let(:embedding_olympics) { Array.new(512, 0.0) + Array.new(512, 1.0) }

  def create_message(embedding:)
    create(:message, :incoming, conversation: conversation, embedding: embedding)
  end

  def call_service(message)
    described_class.new(message_id: message.id).call
  end

  it "creates a new cluster if none exists" do
    message = create_message(embedding: embedding_trump)

    expect { call_service(message) }.to change(MessageCluster, :count).by(1)
    expect(message.reload.message_cluster).to be_present
  end

  it "creates a new cluster if a message does not match any" do
    existing = create_message(embedding: embedding_trump)
    call_service(existing)

    new_message = create_message(embedding: embedding_olympics)

    expect { call_service(new_message) }.to change(MessageCluster, :count).by(1)
  end

  it "assigns message to existing cluster and increments question_count" do
    first = create_message(embedding: embedding_trump)
    call_service(first)

    cluster = first.reload.message_cluster
    second = create_message(embedding: embedding_trump)

    expect { call_service(second) }.not_to change(MessageCluster, :count)

    expect(second.reload.message_cluster_id).to eq(cluster.id)
    expect(cluster.reload.question_count).to eq(2)
  end

  it "acquires a hub-level lock before assigning to prevent concurrent duplicate clusters" do
    # We can't run multiple threads in our tests with our current setup
    # So this test just verifies that the lock is acquired on every call
    message = create_message(embedding: embedding_trump)
    service = described_class.new(message_id: message.id)

    expect(service).to receive(:acquire_hub_lock).and_call_original

    service.call
  end

  it "returns nil for a non-existent message" do
    expect(described_class.new(message_id: 0).call).to be_nil
  end

  it "skips user_contribution_started messages without creating a cluster" do
    message = create(:message, :incoming, conversation: conversation, embedding: embedding_trump, state: :user_contribution_started)

    expect(call_service(message)).to be_nil
    expect(MessageCluster.count).to eq(0)
  end

  it "is idempotent: does not create the same cluster twice" do
    message = create_message(embedding: embedding_trump)

    2.times { call_service(message) }

    expect(MessageCluster.count).to eq(1)
    expect(MessageCluster.first.question_count).to eq(1)
  end
end
