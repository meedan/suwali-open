require "rails_helper"

RSpec.describe Anonymizable do
  describe ExternalUser do
    subject(:eu) { build(:external_user, external_id: "real_id", display_name: "Real Name", metadata: {phone: "555-1234"}.to_json) }

    it "anonymizes external_id" do
      expect(eu.anonymized_attributes["external_id"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes display_name" do
      expect(eu.anonymized_attributes["display_name"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes metadata" do
      expect(eu.anonymized_attributes["metadata"]).to eq("[ANONYMIZED]")
    end

    it "does not include non-PII fields" do
      expect(eu.anonymized_attributes).not_to have_key("platform")
    end
  end

  describe Conversation do
    subject(:conv) { build(:conversation, title: "Real Title") }

    it "anonymizes title" do
      expect(conv.anonymized_attributes["title"]).to eq("[ANONYMIZED]")
    end

    it "does not include non-PII fields" do
      expect(conv.anonymized_attributes).not_to have_key("platform")
    end
  end

  describe Message do
    let(:payload) do
      {
        "id" => "user_123",
        "from" => "Real Name",
        "text" => "Hello there",
        "chat" => {"id" => 99, "type" => "private", "first_name" => "Real", "last_name" => "Name", "username" => "realname"},
        "context" => {"id" => 99, "from" => "Real Name"},
        "message" => {"chat" => {"first_name" => "Real", "last_name" => "Name", "username" => "realname"}}
      }
    end

    subject(:message) { build(:message, payload: payload) }

    it "anonymizes payload id" do
      expect(message.anonymized_attributes["payload"]["id"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes payload from" do
      expect(message.anonymized_attributes["payload"]["from"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes payload chat id, first_name, last_name, username" do
      chat = message.anonymized_attributes["payload"]["chat"]
      expect(chat["id"]).to eq("[ANONYMIZED]")
      expect(chat["first_name"]).to eq("[ANONYMIZED]")
      expect(chat["last_name"]).to eq("[ANONYMIZED]")
      expect(chat["username"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes payload context id, from" do
      context = message.anonymized_attributes["payload"]["context"]
      expect(context["id"]).to eq("[ANONYMIZED]")
      expect(context["from"]).to eq("[ANONYMIZED]")
    end

    it "anonymizes payload message.chat first_name, last_name, username" do
      message_chat = message.anonymized_attributes["payload"]["message"]["chat"]
      expect(message_chat["first_name"]).to eq("[ANONYMIZED]")
      expect(message_chat["last_name"]).to eq("[ANONYMIZED]")
      expect(message_chat["username"]).to eq("[ANONYMIZED]")
    end

    it "preserves non-PII payload fields" do
      expect(message.anonymized_attributes["payload"]["text"]).to eq("Hello there")
    end

    it "preserves non-PII chat fields" do
      chat = message.anonymized_attributes["payload"]["chat"]
      expect(chat["type"]).to eq("private")
    end

    it "does not add keys absent from the payload" do
      message_without_chat = build(:message, payload: payload.except("chat"))
      expect(message_without_chat.anonymized_attributes["payload"]).not_to have_key("chat")
    end
  end
end
