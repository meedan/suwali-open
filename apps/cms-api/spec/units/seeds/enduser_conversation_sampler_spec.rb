require_relative "../../unit_spec_helper"
require_relative "../../../db/seeds/enduser_conversation_sampler"

RSpec.describe EnduserConversationSampler do
  def sampler
    described_class.new(nil)
  end

  def conversation(id, participant_id, messages_count: 1, participant_type: "ExternalUser")
    double(id: id, participant_id: participant_id, participant_type: participant_type, messages_count: messages_count)
  end

  def candidate(id, messages_count: 1)
    double(id: id, conversations: [conversation(id * 100, id, messages_count: messages_count)])
  end

  describe "#pick_active_users" do
    it "stops at USER_LIMIT even when more candidates qualify" do
      users, conversations = sampler.send(:pick_active_users, (1..20).map { |id| candidate(id) })

      expect(users.size).to eq(described_class::USER_LIMIT)
      expect(conversations.size).to eq(described_class::USER_LIMIT)
    end

    it "skips a user whose conversation has no messages and keeps scanning" do
      users, = sampler.send(:pick_active_users, [candidate(1, messages_count: 0), candidate(2)])

      expect(users.map(&:id)).to eq([2])
    end

    it "skips a user with no conversation at all" do
      users, = sampler.send(:pick_active_users, [double(id: 1, conversations: []), candidate(2)])

      expect(users.map(&:id)).to eq([2])
    end

    it "pairs each user with the conversation it was chosen for" do
      users, conversations = sampler.send(:pick_active_users, [candidate(7)])

      expect(users.map(&:id)).to eq([7])
      expect(conversations.map(&:id)).to eq([700])
    end
  end

  describe "#additive_conversations" do
    it "excludes participants the recency sample already covers" do
      result = sampler.send(:additive_conversations, [conversation(1, 10), conversation(2, 20)], Set[10])

      expect(result.map(&:id)).to eq([2])
    end

    it "keeps only the first conversation per participant" do
      conversations = [conversation(1, 10), conversation(2, 10), conversation(3, 20)]

      result = sampler.send(:additive_conversations, conversations, Set.new)

      expect(result.map(&:id)).to eq([1, 3])
    end

    it "ignores a conversation whose participant is not an ExternalUser" do
      conversations = [conversation(1, 10, participant_type: "User"), conversation(2, 20)]

      result = sampler.send(:additive_conversations, conversations, Set.new)

      expect(result.map(&:id)).to eq([2])
    end

    it "caps the result at CONTRIBUTION_LIMIT" do
      conversations = (1..20).map { |id| conversation(id, id) }

      result = sampler.send(:additive_conversations, conversations, Set.new)

      expect(result.size).to eq(described_class::CONTRIBUTION_LIMIT)
    end
  end
end
