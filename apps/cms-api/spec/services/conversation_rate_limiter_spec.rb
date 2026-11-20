require "rails_helper"

RSpec.describe ConversationRateLimiter, type: :service do
  let(:conversation) { create(:conversation) }
  let(:limiter) { described_class.new(conversation) }

  around do |example|
    original_env = ENV.to_h
    example.run
    ENV.replace(original_env)
  end

  before do
    # Clear Redis before each test
    limiter.reset!
    # Set default ENV variables
    ENV["MESSAGE_RATE_LIMIT"] = "1"
    ENV["MESSAGE_RATE_LIMIT_TIMEOUT_MINUTES"] = "30"
  end

  describe "#locked?" do
    context "when MESSAGE_RATE_LIMIT is 0 or negative" do
      it "returns false (rate limiting disabled)" do
        ENV["MESSAGE_RATE_LIMIT"] = "0"
        expect(limiter.locked?).to be false
      end
    end

    context "when MESSAGE_RATE_LIMIT is 1" do
      before do
        ENV["MESSAGE_RATE_LIMIT"] = "1"
      end

      it "returns false when no messages are pending" do
        expect(limiter.locked?).to be false
      end

      it "returns true when one message is pending" do
        limiter.acquire!
        expect(limiter.locked?).to be true
      end

      it "returns false after lock is released" do
        limiter.acquire!
        limiter.release!
        expect(limiter.locked?).to be false
      end
    end

    context "when MESSAGE_RATE_LIMIT is 2" do
      before do
        ENV["MESSAGE_RATE_LIMIT"] = "2"
      end

      it "returns false when one message is pending" do
        limiter.acquire!
        expect(limiter.locked?).to be false
      end

      it "returns true when two messages are pending" do
        limiter.acquire!
        limiter.acquire!
        expect(limiter.locked?).to be true
      end
    end
  end

  describe "#acquire!" do
    it "increments the counter" do
      expect { limiter.acquire! }.to change { limiter.locked? }.from(false).to(true)
    end

    it "sets TTL on first acquisition" do
      limiter.acquire!
      ttl = Sidekiq.redis { |conn| conn.ttl("conversation_rate_limit:#{conversation.id}") }
      expect(ttl).to be > 0
      expect(ttl).to be <= (30 * 60)
    end

    it "returns true" do
      expect(limiter.acquire!).to be true
    end
  end

  describe "#release!" do
    it "decrements the counter" do
      limiter.acquire!
      expect { limiter.release! }.to change { limiter.locked? }.from(true).to(false)
    end

    it "removes key when counter reaches 0" do
      limiter.acquire!
      limiter.release!
      exists = Sidekiq.redis { |conn| conn.exists("conversation_rate_limit:#{conversation.id}") }
      expect(exists).to eq(0)
    end

    it "does not go negative" do
      limiter.release!
      expect(limiter.locked?).to be false
    end

    it "returns true" do
      expect(limiter.release!).to be true
    end
  end

  describe "#reset!" do
    it "clears the lock completely" do
      limiter.acquire!
      limiter.acquire!
      limiter.reset!
      expect(limiter.locked?).to be false
    end

    it "returns true" do
      expect(limiter.reset!).to be true
    end
  end

  describe "multiple conversations" do
    let(:conversation2) { create(:conversation) }
    let(:limiter2) { described_class.new(conversation2) }

    it "maintains separate locks for different conversations" do
      limiter.acquire!
      expect(limiter.locked?).to be true
      expect(limiter2.locked?).to be false

      limiter2.acquire!
      expect(limiter2.locked?).to be true

      limiter.release!
      expect(limiter.locked?).to be false
      expect(limiter2.locked?).to be true
    end
  end

  describe "TTL expiration" do
    it "automatically expires the lock after timeout" do
      ENV["MESSAGE_RATE_LIMIT_TIMEOUT_MINUTES"] = "0.05" # 3 seconds
      limiter.acquire!
      expect(limiter.locked?).to be true
      sleep 4 # Wait for expiration
      expect(limiter.locked?).to be false
    end
  end
end
