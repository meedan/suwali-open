require_relative "../../unit_spec_helper"
require_relative "../../../db/seeds/enduser_conversation_timeshifter"

RSpec.describe EnduserConversationTimeshifter do
  let(:now) { Time.utc(2026, 8, 28, 12, 0, 0) }

  subject { described_class.new(now: now) }

  def message(id, created_at)
    {"id" => id, "body" => "hello", "created_at" => created_at, "updated_at" => created_at + 1}
  end

  def shifted_times(result)
    result["messages"].map { |m| m["created_at"] }
  end

  context "when the snapshot spans more than 30 days" do
    # Three bursts of quick back-and-forth, separated by silences of 40 and 60 days.
    let(:data) do
      base = Time.utc(2026, 1, 1, 9, 0, 0)
      {"messages" => [
        message(1, base),
        message(2, base + 30),
        message(3, base + 40.days),
        message(4, base + 40.days + 120),
        message(5, base + 100.days),
        message(6, base + 100.days + 90)
      ]}
    end

    it "fits the timeline into the last 30 days, ending now" do
      result = subject.shift(data)

      expect(shifted_times(result).first).to eq(now - 30.days)
      expect(result["messages"].last["updated_at"]).to eq(now)
    end

    it "preserves gaps that are under the threshold exactly" do
      times = shifted_times(subject.shift(data))

      expect(times[1] - times[0]).to eq(30)
      expect(times[3] - times[2]).to eq(120)
      expect(times[5] - times[4]).to eq(90)
    end

    it "squeezes only the long silences" do
      times = shifted_times(subject.shift(data))

      expect(times[2] - times[1]).to be < 40.days
      expect(times[4] - times[3]).to be < 60.days
      # The longer silence stays the longer one.
      expect(times[4] - times[3]).to be > (times[2] - times[1])
    end

    it "shifts every timestamp in the row, not just created_at" do
      result = subject.shift(data)

      result["messages"].each do |m|
        expect(m["updated_at"] - m["created_at"]).to eq(1)
      end
    end
  end

  context "when the snapshot already fits in 30 days" do
    let(:data) do
      base = Time.utc(2026, 8, 1, 9, 0, 0)
      {"messages" => [message(1, base), message(2, base + 2.days), message(3, base + 5.days)]}
    end

    it "shifts without compressing" do
      result = subject.shift(data)
      times = shifted_times(result)

      expect(result["messages"].last["updated_at"]).to eq(now)
      expect(times[1] - times[0]).to eq(2.days)
      expect(times[2] - times[1]).to eq(3.days)
    end
  end

  it "shifts related tables onto the same timeline" do
    base = Time.utc(2026, 1, 1, 9, 0, 0)
    data = {
      "external_users" => [{"id" => 1, "created_at" => base, "last_message_at" => base + 100.days}],
      "messages" => [
        {"id" => 1, "created_at" => base + 50.days},
        {"id" => 2, "created_at" => base + 100.days}
      ]
    }

    result = subject.shift(data)

    expect(result["external_users"].first["created_at"]).to eq(now - 30.days)
    expect(result["external_users"].first["last_message_at"]).to eq(now)
    expect(result["messages"].last["created_at"]).to eq(now)
  end

  it "returns the data unchanged when there is nothing to order" do
    data = {"messages" => [{"id" => 1, "body" => "hello"}]}

    expect(subject.shift(data)).to eq(data)
  end
end
