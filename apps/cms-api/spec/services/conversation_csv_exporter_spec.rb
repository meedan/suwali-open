require "rails_helper"
require "csv"

RSpec.describe ConversationCsvExporter, type: :service do
  describe "#generate" do
    def export(*conversations)
      CSV.parse(ConversationCsvExporter.new(conversations).generate, headers: true)
    end

    def external_conversation(phone: "+15550100", **attributes)
      participant = create(:external_user, platform: :whatsapp, external_id: phone, display_name: "Jane Phone")
      create(:conversation, platform: :whatsapp, participant: participant, hub: participant.hub, **attributes)
    end

    it "exports one row per message with the conversation, message and answer metadata columns" do
      conversation = external_conversation
      question = create(:message, :incoming, conversation: conversation, body: "Where do I vote?",
        created_at: Time.zone.parse("2026-10-01 12:00:00 -03:00"),
        metadata: {"context_updates" => [{"op" => "add", "text" => "Lives in Nairobi"}]})
      answer = create(:message, :outgoing, conversation: conversation, body: "At the school.", reply_to: question,
        answered: true, created_at: Time.utc(2026, 10, 1, 15, 1),
        metadata: {"document_ids_used" => ["RG9jdW1lbnQvMQ==\n"], "retrieved_chunks" => ["Polls open at 7am"]})
      document = create(:document, title: "Polling places")
      create(:message_data_source_item, message: answer, item: document)

      rows = export(conversation)

      expect(rows.headers).to eq(%w[convo_id user_id user_type platform message_id sender timestamp message answered
        reply_to_id context cited_sources document_ids_used retrieved_chunks])
      expect(rows.map(&:to_h)).to eq([
        {
          "convo_id" => conversation.id.to_s, "user_id" => conversation.participant_id.to_s, "user_type" => "ExternalUser",
          "platform" => "whatsapp", "message_id" => question.id.to_s, "sender" => "human", "timestamp" => "2026-10-01T15:00:00Z",
          "message" => "Where do I vote?", "answered" => nil, "reply_to_id" => nil,
          "context" => [{op: "add", text: "Lives in Nairobi"}].to_json,
          "cited_sources" => "[]", "document_ids_used" => "[]", "retrieved_chunks" => "[]"
        },
        {
          "convo_id" => conversation.id.to_s, "user_id" => conversation.participant_id.to_s, "user_type" => "ExternalUser",
          "platform" => "whatsapp", "message_id" => answer.id.to_s, "sender" => "bot", "timestamp" => "2026-10-01T15:01:00Z",
          "message" => "At the school.", "answered" => "true", "reply_to_id" => question.id.to_s,
          "context" => "[]",
          "cited_sources" => [{type: "Document", id: document.id, title: "Polling places"}].to_json,
          "document_ids_used" => ["RG9jdW1lbnQvMQ==\n"].to_json, "retrieved_chunks" => ["Polls open at 7am"].to_json
        }
      ])
    end

    it "orders messages oldest first by id and keeps only the latest MAX_MESSAGES" do
      stub_const("ConversationCsvExporter::MAX_MESSAGES", 2)
      conversation = external_conversation
      create(:message, :incoming, conversation: conversation)
      second = create(:message, :outgoing, conversation: conversation)
      third = create(:message, :incoming, conversation: conversation, created_at: 1.year.ago)

      rows = export(conversation)

      expect(rows.map { |row| row["message_id"] }).to eq([second.id.to_s, third.id.to_s])
    end

    it "exports answered false for an unanswered bot reply" do
      conversation = external_conversation
      create(:message, :outgoing, conversation: conversation, answered: false)

      rows = export(conversation)

      expect(rows.first["answered"]).to eq("false")
    end

    it "exports [] for metadata arrays stored as null" do
      conversation = external_conversation
      create(:message, :outgoing, conversation: conversation,
        metadata: {"context_updates" => nil, "document_ids_used" => nil, "retrieved_chunks" => nil})

      rows = export(conversation)

      expect(rows.first.to_h.values_at("context", "document_ids_used", "retrieved_chunks")).to eq(["[]", "[]", "[]"])
    end

    it "neutralizes spreadsheet formulas in message bodies" do
      conversation = external_conversation
      create(:message, :incoming, conversation: conversation, body: '=HYPERLINK("http://evil.example")')

      rows = export(conversation)

      expect(rows.first["message"]).to eq(%('=HYPERLINK("http://evil.example")))
    end

    it "keeps the cited source title after the item is deleted" do
      conversation = external_conversation
      answer = create(:message, :outgoing, conversation: conversation)
      document = create(:document, title: "Removed guide")
      create(:message_data_source_item, message: answer, item: document)
      document.delete

      rows = export(conversation)

      expect(JSON.parse(rows.first["cited_sources"])).to eq([{"type" => "Document", "id" => document.id, "title" => "Removed guide"}])
    end

    it "leaves the external user's phone number, name and raw payload out of the export" do
      conversation = external_conversation(phone: "+15550199", title: "Jane Phone")
      create(:message, :incoming, conversation: conversation, external_id: "wamid.SECRET",
        payload: {"from" => "15550199", "ProfileName" => "Jane Phone"},
        metadata: {"personalization_snapshot" => {"name" => "Jane Phone"}})

      output = ConversationCsvExporter.new([conversation]).generate

      expect(output).not_to include("15550199")
      expect(output).not_to include("Jane Phone")
      expect(output).not_to include("wamid.SECRET")
    end

    it "exports an internal conversation as HubUser on the internal platform without the team member's name or email" do
      user = create(:user, name: "Tina Team", email: "tina@example.org")
      conversation = create(:conversation, participant: user)
      create(:message, :incoming, conversation: conversation)

      output = ConversationCsvExporter.new([conversation]).generate
      rows = CSV.parse(output, headers: true)

      expect(rows.map { |row| row.to_h.values_at("user_id", "user_type", "platform", "sender") }).to eq([[user.id.to_s, "HubUser", "internal", "human"]])
      expect(output).not_to include("Tina Team")
      expect(output).not_to include("tina@example.org")
    end

    it "exports the rows of every conversation given, with the same user_id for the same participant" do
      first = create(:conversation)
      second = create(:conversation, participant: first.participant, hub: first.hub)
      first_message = create(:message, :incoming, conversation: first)
      second_message = create(:message, :incoming, conversation: second)

      rows = export(first, second)

      expect(rows.map { |row| row.to_h.values_at("convo_id", "user_id", "message_id") }).to eq([
        [first.id.to_s, first.participant_id.to_s, first_message.id.to_s],
        [second.id.to_s, first.participant_id.to_s, second_message.id.to_s]
      ])
    end
  end

  describe "#write" do
    it "writes the same CSV that #generate returns to the given IO" do
      conversation = create(:conversation)
      question = create(:message, :incoming, conversation: conversation, body: "=Where do I vote?")
      create(:message, :outgoing, conversation: conversation, reply_to: question, answered: true)
      io = StringIO.new

      ConversationCsvExporter.new([conversation]).write(io)

      expect(io.string).to eq(ConversationCsvExporter.new([conversation]).generate)
    end
  end
end
