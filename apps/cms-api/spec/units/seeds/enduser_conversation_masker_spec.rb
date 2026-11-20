require_relative "../../unit_spec_helper"
require_relative "../../../db/seeds/enduser_conversation_masker"

RSpec.describe EnduserConversationMasker do
  let(:eu_id) { 1 }
  let(:conv_id) { 10 }

  let(:anonymized_payload) do
    {
      "id" => "[ANONYMIZED]",
      "from" => "[ANONYMIZED]",
      "text" => "Hello there",
      "chat" => {"id" => "[ANONYMIZED]", "type" => "private", "first_name" => "[ANONYMIZED]", "last_name" => "[ANONYMIZED]", "username" => "[ANONYMIZED]"},
      "context" => {"id" => "[ANONYMIZED]", "from" => "[ANONYMIZED]"},
      "message" => {"chat" => {"first_name" => "[ANONYMIZED]", "last_name" => "[ANONYMIZED]", "username" => "[ANONYMIZED]"}}
    }
  end

  let(:data) do
    {
      "external_users" => [{"id" => eu_id, "external_id" => "[ANONYMIZED]", "display_name" => "[ANONYMIZED]", "metadata" => "[ANONYMIZED]", "platform" => "telegram"}],
      "conversations" => [{"id" => conv_id, "participant_id" => eu_id, "title" => "[ANONYMIZED]", "platform" => "telegram"}],
      "messages" => [{"id" => 100, "conversation_id" => conv_id, "body" => "Hello there", "payload" => anonymized_payload}]
    }
  end

  before do
    allow_any_instance_of(described_class).to receive(:fake_name_parts).and_return(["Jane", "Smith"])
    allow_any_instance_of(described_class).to receive(:fake_username).and_return("jane.smith")
    allow_any_instance_of(described_class).to receive(:fake_phone_number).and_return("+15551234567")
  end

  subject(:result) { described_class.new.mask(data) }

  describe "#mask" do
    it "replaces external_user PII fields with fake values" do
      eu = result["external_users"].first
      expect(eu["external_id"]).to eq("jane.smith")
      expect(eu["display_name"]).to eq("Jane Smith")
      expect(eu["metadata"]).to eq({})
    end

    it "replaces conversation title with a fake value" do
      expect(result["conversations"].first["title"]).to eq("Jane Smith")
    end

    it "replaces message payload PII fields with fake values" do
      payload = result["messages"].first["payload"]
      expect(payload["id"]).to eq("jane.smith")
      expect(payload["from"]).to eq("id" => "jane.smith", "username" => "jane.smith", "last_name" => "Smith", "first_name" => "Jane")
      expect(payload["chat"]["id"]).to eq("jane.smith")
      expect(payload["context"]["id"]).to eq("jane.smith")
      expect(payload["context"]["from"]).to eq("Jane Smith")
      expect(payload["chat"]["first_name"]).to eq("Jane")
      expect(payload["chat"]["last_name"]).to eq("Smith")
      expect(payload["chat"]["username"]).to eq("jane.smith")
      expect(payload["message"]["chat"]["first_name"]).to eq("Jane")
      expect(payload["message"]["chat"]["last_name"]).to eq("Smith")
      expect(payload["message"]["chat"]["username"]).to eq("jane.smith")
    end

    it "masks external_id and from with phone number for whatsapp" do
      whatsapp_data = data.merge("external_users" => [data["external_users"].first.merge("platform" => "whatsapp")])
      result = described_class.new.mask(whatsapp_data)
      expect(result["external_users"].first["external_id"]).to eq("15551234567")
      expect(result["messages"].first["payload"]["from"]).to eq("15551234567")
    end

    it "uses consistent fake values across related records" do
      eu = result["external_users"].first
      conv = result["conversations"].first
      payload = result["messages"].first["payload"]

      expect(eu["display_name"]).to eq("Jane Smith")
      expect(conv["title"]).to eq("Jane Smith")
      expect(payload["from"]["first_name"]).to eq("Jane")
      expect(payload["chat"]["first_name"]).to eq("Jane")
    end

    it "preserves non-PII fields" do
      expect(result["external_users"].first["platform"]).to eq("telegram")
      expect(result["conversations"].first["platform"]).to eq("telegram")
      expect(result["messages"].first["body"]).to eq("Hello there")
      expect(result["messages"].first["payload"]["text"]).to eq("Hello there")
    end

    it "preserves non-PII payload chat fields" do
      chat = result["messages"].first["payload"]["chat"]
      expect(chat["type"]).to eq("private")
    end

    it "does not add payload keys absent from the anonymized data" do
      payload_without_chat = anonymized_payload.except("chat")
      data_without_chat = data.merge("messages" => [data["messages"].first.merge("payload" => payload_without_chat)])
      result = described_class.new.mask(data_without_chat)
      expect(result["messages"].first["payload"]).not_to have_key("chat")
    end
  end

  describe "generated names" do
    # These run against the real generator, so undo the stubs above.
    before { allow_any_instance_of(described_class).to receive(:fake_name_parts).and_call_original }

    let(:real_artists) { described_class::ROCK_STARS.map { |first, last| "#{first} #{last}" } }

    it "never produces a real artist's name" do
      masker = described_class.new
      names = 2_000.times.map { masker.send(:fake_name_parts).join(" ") }

      expect(names & real_artists).to be_empty
    end

    it "does not repeat a name within one snapshot" do
      masker = described_class.new
      names = 40.times.map { masker.send(:fake_name_parts).join(" ") }

      expect(names.uniq.size).to eq(names.size)
    end
  end
  describe ".leaks" do
    def snapshot(external_id: "1", payload: {})
      {"messages" => [{"external_id" => external_id, "payload" => payload}]}
    end

    it "is empty when nothing escaped" do
      masked = snapshot(external_id: "wamid.#{Base64.strict_encode64("15551234567-0")}", payload: {"from_user_id" => "XX.123"})

      expect(described_class.leaks(masked)).to be_empty
    end

    it "reports a phone number recoverable from a wamid" do
      masked = snapshot(external_id: "wamid.#{Base64.strict_encode64("19254827565-0")}")

      expect(described_class.leaks(masked)).to eq(["19254827565"])
    end

    it "reports an unmasked from_user_id" do
      masked = snapshot(payload: {"from_user_id" => "BR.1965426784058801"})

      expect(described_class.leaks(masked)).to eq(["BR.1965426784058801"])
    end

    it "reports a media URL pointing at the real CDN" do
      masked = snapshot(payload: {"image" => {"url" => "https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1"}})

      expect(described_class.leaks(masked)).to eq([described_class::REAL_MEDIA_HOST])
    end
  end
end
