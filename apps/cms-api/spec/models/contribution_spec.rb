require "rails_helper"

RSpec.describe Contribution, type: :model do
  it "is valid with valid attributes" do
    contribution = build(:contribution)
    expect(contribution).to be_valid
  end

  it "is invalid without content" do
    contribution = build(:contribution, content: nil)
    expect(contribution).not_to be_valid
  end

  it "enqueues KnowledgeServiceWorker after create" do
    expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", anything)
    create(:contribution)
  end

  it "enqueues topic extraction instead of ingestion when created paused" do
    hub = create(:hub, contribution_workflow_mode: :review)
    message = create(:message, :incoming)

    expect(KnowledgeServiceWorker).not_to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", anything)
    expect(KnowledgeServiceWorker).to receive(:perform_async).with("extract_community_knowledge_topics", anything)
    create(:contribution, hub: hub, message: message)
  end

  it "does not enqueue topic extraction when created active" do
    message = create(:message, :incoming)

    expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "ingest_community_knowledge", anything)
    expect(KnowledgeServiceWorker).not_to receive(:perform_async).with("extract_community_knowledge_topics", anything)
    create(:contribution, message: message)
  end

  it "enqueues KnowledgeServiceWorker after destroy" do
    contribution = create(:contribution)
    expect(KnowledgeServiceWorker).to receive(:perform_in).with(5.seconds, "delete_community_knowledge", contribution.id, contribution.hub_id)
    contribution.destroy
  end

  describe "#text_for_summarization" do
    it "returns the contribution content" do
      contribution = create(:contribution, content: "My contribution")
      expect(contribution.text_for_summarization).to eq("My contribution")
    end
  end

  it "returns the title" do
    contribution = create(:contribution, content: "Neque porro quisquam est qui dolorem ipsum quia dolor sit amet, consectetur, adipisci velit")
    expect(contribution.title).to eq("Neque porro quisquam est qui dolorem ipsum quia dolor sit ame...")
  end

  it "includes its topics in as_json" do
    contribution = create(:contribution)
    topic_item = contribution.topic_items.create!(topic: contribution.hub.topics.create!(name: "Climate"))

    expect(contribution.as_json[:topics].map(&:as_json)).to eq([{id: topic_item.id, topic_id: topic_item.topic_id, name: "Climate"}])
  end

  it "returns data_source_payload for internal user" do
    contribution = create(:contribution)

    expect(contribution.data_source_payload).to include({
      updated_at: contribution.updated_at,
      content: contribution.content,
      active: contribution.active,
      message: {
        conversation: {
          platform: contribution.message.conversation.platform,
          participant: {
            name: contribution.message.conversation.participant.name,
            type: contribution.message.conversation.participant_type,
            trusted_user: false
          }
        }
      }
    })
  end

  # To-Do: Clean Up this test
  it "returns data_source_payload for external user" do
    external_user = create(:external_user)
    message = create(:message, direction: :outgoing, conversation: create(:conversation, platform: 1, participant: external_user))
    contribution = create(:contribution, message: message)

    expect(contribution.data_source_payload).to include({
      updated_at: contribution.updated_at,
      content: contribution.content,
      active: contribution.active,
      message: {
        conversation: {
          platform: contribution.message.conversation.platform,
          participant: {
            name: message.conversation.participant.display_name,
            type: contribution.message.conversation.participant_type,
            trusted_user: false
          }
        }
      }
    })
  end

  it "includes priority_tier in data_source_payload" do
    contribution = create(:contribution, priority_tier: 2)
    expect(contribution.data_source_payload).to include(priority_tier: 2)
  end

  describe "#set_active_from_hub_workflow" do
    it "sets active to true when hub workflow mode is direct" do
      hub = create(:hub, contribution_workflow_mode: :direct)
      contribution = create(:contribution, hub: hub)
      expect(contribution.active).to be true
    end

    it "sets active to false when hub workflow mode is review" do
      hub = create(:hub, contribution_workflow_mode: :review)
      contribution = create(:contribution, hub: hub)
      expect(contribution.active).to be false
    end

    it "defaults to direct workflow mode (active = true)" do
      contribution = create(:contribution)
      expect(contribution.hub.direct?).to be true
      expect(contribution.active).to be true
    end

    it "respects explicitly set active value" do
      hub = create(:hub, contribution_workflow_mode: :direct)
      contribution = create(:contribution, hub: hub, active: false)
      expect(contribution.active).to be false
    end
  end

  describe "first-time vs returning contributors" do
    let(:hub) { create(:hub) }
    let(:user1) { create(:conversation, :external, hub: hub) }
    let(:user2) { create(:conversation, :external, hub: hub) }

    def contribution(at:, from_conversation: user1)
      message = create(:message, :incoming, conversation: from_conversation, created_at: at)
      create(:contribution, message: message, hub: hub, created_at: at)
    end

    it "marks only each contributor's first contribution, and records when it arrived" do
      first = contribution(at: 3.weeks.ago)
      second = contribution(at: 1.week.ago)
      other_contributor = contribution(at: 1.week.ago, from_conversation: user2)

      expect(first.first_time_contributor).to be true
      expect(second.first_time_contributor).to be false
      expect(other_contributor.first_time_contributor).to be true
      expect(second.contributor.first_contribution_at).to be_within(1.second).of(first.created_at)
    end

    # The flag records what was true when the contribution arrived, so figures already reported
    # do not change when history is edited
    it "does not promote the next contribution when the first one is deleted" do
      first = contribution(at: 3.weeks.ago)
      second = contribution(at: 1.week.ago)

      first.destroy!

      expect(second.reload.first_time_contributor).to be false
    end
  end

  it_behaves_like "knowledge_service_syncable"

  describe ".ordered_by_participant_name" do
    let(:hub) { create(:hub) }

    def contribute(participant)
      conversation = create(:conversation, hub: hub, participant: participant, platform: participant.is_a?(User) ? 0 : 1)
      create(:contribution, hub: hub, message: create(:message, :incoming, conversation: conversation))
    end

    it "orders by the name of the conversation's participant" do
      zed = contribute(create(:user, name: "Zed", email: "zed@example.com"))
      amy = contribute(create(:external_user, hub: hub, external_id: "amy", display_name: "Amy", trusted_user: true))

      expect(hub.contributions.ordered_by_participant_name("asc")).to eq([amy, zed])
      expect(hub.contributions.ordered_by_participant_name("desc")).to eq([zed, amy])
    end

    it "breaks ties between one participant's contributions by contribution id" do
      conversation = create(:conversation, hub: hub)
      first, second = Array.new(2) { create(:contribution, hub: hub, message: create(:message, :incoming, conversation: conversation)) }

      expect(hub.contributions.ordered_by_participant_name("asc")).to eq([first, second])
      expect(hub.contributions.ordered_by_participant_name("desc")).to eq([second, first])
    end
  end

  describe ".from_end_users" do
    let(:hub) { create(:hub) }

    def contribute(participant)
      conversation = create(:conversation, hub: hub, participant: participant, platform: participant.is_a?(User) ? 0 : 1)
      create(:contribution, hub: hub, message: create(:message, :incoming, conversation: conversation))
    end

    let!(:anonymous) { contribute(create(:external_user, hub: hub, external_id: "anon", trusted_user: false)) }
    let!(:trusted) { contribute(create(:external_user, hub: hub, external_id: "trusted", trusted_user: true)) }
    let!(:team_member) { contribute(create(:user, email: "team@example.com")) }

    it "keeps the contributions of the type of end-user, and leaves out those of anyone else" do
      expect(hub.contributions.from_end_users(trusted: [true])).to eq([trusted])
      expect(hub.contributions.from_end_users(trusted: [false])).to eq([anonymous])
      expect(hub.contributions.from_end_users(trusted: [true, false])).to contain_exactly(anonymous, trusted)
    end

    it "does not reach the contributions of another hub" do
      other_hub = create(:hub)
      other = create(:contribution, hub: other_hub, message: create(:message, :incoming, conversation: create(:conversation, :external, hub: other_hub)))

      expect(hub.contributions.from_end_users(trusted: [false])).not_to include(other)
    end
  end
end
