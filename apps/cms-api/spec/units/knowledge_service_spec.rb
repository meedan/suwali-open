require_relative "../unit_spec_helper"
require_relative "../../app/services/log_service"
require_relative "../../app/services/knowledge_service"

require "base64"
require "cgi"
require "faraday"
require "logger"
require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

# Stub Rails for unit tests
module Rails # standard:disable Lint/ConstantDefinitionInBlock
  class << self
    def logger
      @logger ||= Logger.new(nil)
    end

    def env
      @env ||= ActiveSupport::StringInquirer.new("test")
    end
  end
end

# Stub ActiveSupport::StringInquirer for unit tests
module ActiveSupport
  class StringInquirer < String
    def production?
      self == "production"
    end

    def test?
      self == "test"
    end

    def development?
      self == "development"
    end
  end
end

RSpec.describe KnowledgeService do
  let(:base_url) { "http://knowledge:8000" }
  let(:hub_id) { 42 }
  let(:document_id) { Base64.encode64("Document/12") }
  let(:file_url) { "s3://bucket/file.pdf" }
  let(:message) { "Hello world" }
  let(:message_id) { 123 }
  let(:history) { [{"role" => "user", "content" => "Previous message"}] }
  let(:ingest_response) { {"id" => "95f20c77-e7c1-4bc7-af3b-b9ea5ccf621e", "status" => "queued"} }
  let(:chat_response) { {"answer" => "The answer", "metadata" => {"documents_count" => 3}} }
  let(:delete_response) { {"status" => "queued", "id" => "job_id"} }
  let(:callback_url) { "http://localhost:3000/api/knowledge-service-callbacks/update-sync-status?id=#{CGI.escape(document_id)}&token=test_token" }

  before do
    stub_const("KnowledgeService::BASE_URL", base_url)
    ENV["CMS_API_INTERNAL_URL"] = "http://localhost:3000"
    ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = "test_token"
  end

  describe ".ingest" do
    it "succeeds and returns true" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url)
      expect(result).to be true
    end

    it "includes priority_tier in payload when provided" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url, priority_tier: 1}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url, nil, nil, nil, 1)
      expect(result).to be true
    end

    it "omits priority_tier from payload when not provided" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url)
      expect(result).to be true
    end

    it "includes existing_topics in payload when provided" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: ["Climate", "Elections"], text_is_markdown: false, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url, nil, nil, nil, nil, ["Climate", "Elections"])
      expect(result).to be true
    end

    it "includes text_is_markdown in payload when true" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: "", text: "# Heading", original_url: "", published_at: "", existing_topics: [], text_is_markdown: true, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, nil, "# Heading", nil, nil, nil, [], true)
      expect(result).to be true
    end

    it "sends the data source item type as the Knowledge Service's document_type" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url, document_type: "contribution"}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url, nil, nil, nil, nil, [], false, "contribution")
      expect(result).to be true
    end

    it "includes summary in payload when provided" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url, document_type: "document", summary: "User summary"}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url, nil, nil, nil, nil, [], false, "document", "User summary")
      expect(result).to be true
    end

    it "omits document_type from payload when no data source item type is given" do
      stub_request(:post, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, file_url: file_url, text: "", original_url: "", published_at: "", existing_topics: [], text_is_markdown: false, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: ingest_response.to_json)

      result = described_class.ingest(hub_id, document_id, file_url)
      expect(result).to be true
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/document/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.ingest(hub_id, file_url)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end
  end

  describe ".chat" do
    let(:job_response) { {"id" => "job-123", "status" => "queued"} }

    it "enqueues a chat job with callback_url" do
      stub_request(:post, "#{base_url}/chat/")
        .with(
          body: hash_including("hub_id" => hub_id, "message_id" => message_id, "message" => message, "history" => []),
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: job_response.to_json)

      result = described_class.chat(hub_id, message_id, message)
      expect(result["id"]).to eq("job-123")
    end

    it "includes callback_url in the payload" do
      stub_request(:post, "#{base_url}/chat/")
        .to_return(status: 200, body: job_response.to_json)

      described_class.chat(hub_id, message_id, message)

      expect(WebMock).to have_requested(:post, "#{base_url}/chat/")
        .with { |req| JSON.parse(req.body)["callback_url"].include?("update-chat-status") }
    end

    it "sends history in the payload" do
      stub_request(:post, "#{base_url}/chat/")
        .with(
          body: hash_including("hub_id" => hub_id, "message_id" => message_id, "message" => message, "history" => history),
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: job_response.to_json)

      result = described_class.chat(hub_id, message_id, message, history)
      expect(result["id"]).to eq("job-123")
    end

    it "sends the conversation context only when given" do
      stub_request(:post, "#{base_url}/chat/").to_return(status: 200, body: job_response.to_json)

      described_class.chat(hub_id, message_id, message)
      described_class.chat(hub_id, message_id, message, [], {}, nil, [], [])

      expect(WebMock).to have_requested(:post, "#{base_url}/chat/").with { |req| !JSON.parse(req.body).key?("conversation_context") }.once
      expect(WebMock).to have_requested(:post, "#{base_url}/chat/").with { |req| JSON.parse(req.body)["conversation_context"] == [] }.once
    end

    it "sends the location gate flag only when given" do
      stub_request(:post, "#{base_url}/chat/").to_return(status: 200, body: job_response.to_json)

      described_class.chat(hub_id, message_id, message)
      described_class.chat(hub_id, message_id, message, [], {}, nil, [], [], false)
      described_class.chat(hub_id, message_id, message, [], {}, nil, [], [], true)

      expect(WebMock).to have_requested(:post, "#{base_url}/chat/").with { |req| !JSON.parse(req.body).key?("location_gate_enabled") }.once
      expect(WebMock).to have_requested(:post, "#{base_url}/chat/").with { |req| JSON.parse(req.body)["location_gate_enabled"] == false }.once
      expect(WebMock).to have_requested(:post, "#{base_url}/chat/").with { |req| JSON.parse(req.body)["location_gate_enabled"] == true }.once
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/chat/")
        .to_return(status: 400, body: "Bad Request")

      expect {
        described_class.chat(hub_id, message_id, message)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end
  end

  describe ".delete" do
    it "succeeds and returns true" do
      stub_request(:delete, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: delete_response.to_json)

      result = described_class.delete(hub_id, document_id)
      expect(result).to be true
    end

    it "raises on failure" do
      stub_request(:delete, "#{base_url}/document/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.delete(hub_id, document_id)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end

    it "does nothing on 204" do
      stub_request(:delete, "#{base_url}/document/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, callback_url: callback_url}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 204, body: nil)

      result = described_class.delete(hub_id, document_id)
      expect(result).to be true
    end
  end

  describe ".summarize" do
    let(:texts) { ["Text 1", "Text 2", "Text 3"] }
    let(:summarize_response) { {"summary" => "This is a summary of the texts"} }

    it "returns the summary" do
      stub_request(:post, "#{base_url}/summarize/")
        .with(
          body: {texts: texts}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: summarize_response.to_json)

      result = described_class.summarize(texts)
      expect(result).to eq("This is a summary of the texts")
    end

    it "includes default_language in the payload when provided" do
      stub_request(:post, "#{base_url}/summarize/")
        .with(
          body: {texts: texts, default_language: "es"}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: summarize_response.to_json)

      result = described_class.summarize(texts, default_language: "es")
      expect(result).to eq("This is a summary of the texts")
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/summarize/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.summarize(texts)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end

    context "when summarizing a document's ingested chunks" do
      let(:summarize_response) { {"summary" => "This is a summary of the document"} }

      it "returns the summary" do
        stub_request(:post, "#{base_url}/summarize/")
          .with(
            body: {hub_id: hub_id, document_id: document_id}.to_json,
            headers: {"Content-Type" => "application/json"}
          ).to_return(status: 200, body: summarize_response.to_json)

        result = described_class.summarize(hub_id: hub_id, document_id: document_id)
        expect(result).to eq("This is a summary of the document")
      end

      it "includes default_language in the payload when provided" do
        stub_request(:post, "#{base_url}/summarize/")
          .with(
            body: {hub_id: hub_id, document_id: document_id, default_language: "es"}.to_json,
            headers: {"Content-Type" => "application/json"}
          ).to_return(status: 200, body: summarize_response.to_json)

        result = described_class.summarize(hub_id: hub_id, document_id: document_id, default_language: "es")
        expect(result).to eq("This is a summary of the document")
      end
    end
  end

  describe ".detect_language" do
    it "returns the detected language, passing the hub languages as context" do
      stub_request(:post, "#{base_url}/language/")
        .with(body: {text: "hola", default_language: "en", supported_languages: ["en", "es"]}.to_json)
        .to_return(status: 200, body: {"language" => "es"}.to_json)

      expect(described_class.detect_language("hola", "en", ["en", "es"])).to eq("es")
    end

    it "raises on failure without logging the text" do
      stub_request(:post, "#{base_url}/language/").to_return(status: 500, body: "boom")
      expect(LogService).to receive(:log) { |_level, _context, message| expect(message).not_to include("hola") }

      expect { described_class.detect_language("hola") }.to raise_error(KnowledgeService::Error)
    end
  end

  describe ".extract_topics" do
    let(:existing_topics) { ["Elections", "Climate Policy"] }

    it "returns the extracted topics" do
      stub_request(:post, "#{base_url}/topics/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, text: "", existing_topics: existing_topics}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: {"topics" => ["Elections", "Health"]}.to_json)

      result = described_class.extract_topics(hub_id, document_id, existing_topics)
      expect(result).to eq(["Elections", "Health"])
    end

    it "sends the text when the item was never ingested" do
      stub_request(:post, "#{base_url}/topics/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, text: "Some content", existing_topics: existing_topics}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: {"topics" => ["Health"]}.to_json)

      expect(described_class.extract_topics(hub_id, document_id, existing_topics, "Some content")).to eq(["Health"])
    end

    it "returns an empty array when the response has no topics" do
      stub_request(:post, "#{base_url}/topics/")
        .to_return(status: 200, body: {"topics" => nil}.to_json)

      expect(described_class.extract_topics(hub_id, document_id)).to eq([])
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/topics/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.extract_topics(hub_id, document_id)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end
  end

  describe ".update_topics" do
    it "sends the topics to the Knowledge Service" do
      stub_request(:put, "#{base_url}/document/topics/")
        .with(
          body: {hub_id: hub_id, document_id: document_id, topics: ["Elections", "Health"]}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: {updated: true, error: nil}.to_json)

      expect(described_class.update_topics(hub_id, document_id, ["Elections", "Health"])).to be_truthy
    end

    it "raises when the document is not found" do
      stub_request(:put, "#{base_url}/document/topics/")
        .to_return(status: 404, body: {updated: false, error: "Document not found"}.to_json)

      expect {
        described_class.update_topics(hub_id, document_id, [])
      }.to raise_error(KnowledgeService::Error, /404/)
    end

    it "raises on failure" do
      stub_request(:put, "#{base_url}/document/topics/")
        .to_return(status: 500, body: {updated: false, error: "Failed to update document topics"}.to_json)

      expect {
        described_class.update_topics(hub_id, document_id, ["Elections"])
      }.to raise_error(KnowledgeService::Error, /500/)
    end
  end

  describe ".preview" do
    let(:scenario) { "role_description" }
    let(:personalization) do
      {
        name: "TestBot",
        description: "I help users find information",
        tone: "journalist",
        external_resources: [
          {
            title: "https://example.com/guide",
            description: "User guide",
            scenarios: ["role_description"]
          }
        ]
      }
    end
    let(:preview_response) { {"answer" => "I'm TestBot. I help users find information."} }

    it "returns the preview answer" do
      stub_request(:post, "#{base_url}/preview/")
        .with(
          body: {scenario: scenario, personalization: personalization}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: preview_response.to_json)

      result = described_class.preview(scenario, personalization)
      expect(result).to eq("I'm TestBot. I help users find information.")
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/preview/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.preview(scenario, personalization)
      }.to raise_error(KnowledgeService::Error, /failed/)
    end
  end

  describe ".request with timeouts" do
    it "raises KnowledgeService::Error on Faraday::TimeoutError" do
      stub_request(:post, "#{base_url}/document/")
        .to_raise(Faraday::TimeoutError.new("timeout"))

      expect(LogService).to receive(:log).with(:error, "KnowledgeService", /Request timeout/)

      expect {
        described_class.ingest(hub_id, document_id, file_url)
      }.to raise_error(KnowledgeService::Error, /timed out after/)
    end
  end

  describe ".request with network errors" do
    it "raises KnowledgeService::Error on Faraday::Error" do
      stub_request(:post, "#{base_url}/document/")
        .to_raise(Faraday::ConnectionFailed.new("Connection refused"))

      expect(LogService).to receive(:log).with(:error, "KnowledgeService", /Network error/)

      expect {
        described_class.ingest(hub_id, document_id, file_url)
      }.to raise_error(KnowledgeService::Error, /Network error/)
    end
  end

  describe ".embed" do
    let(:embedding_vector) { Array.new(1024) { rand } }
    let(:embed_response) { {"embedding" => embedding_vector} }

    it "returns the text embedding" do
      stub_request(:post, "#{base_url}/embed/")
        .with(
          body: {text: "What is love?"}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 200, body: embed_response.to_json)

      result = described_class.embed("What is love?")
      expect(result).to eq(embedding_vector)
      expect(result).to be_an(Array)
      expect(result.length).to eq(1024)
    end

    it "raises on failure" do
      stub_request(:post, "#{base_url}/embed/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.embed("What is love?")
      }.to raise_error(KnowledgeService::Error, /failed/)
    end

    it "raises TooLongMessageError on 422 (text too long)" do
      stub_request(:post, "#{base_url}/embed/")
        .with(
          body: {text: "What is love?"}.to_json,
          headers: {"Content-Type" => "application/json"}
        ).to_return(status: 422, body: {embedding: nil, error_type: "QUESTION_TOO_LONG"}.to_json)

      expect {
        described_class.embed("What is love?")
      }.to raise_error(KnowledgeService::TooLongMessageError)
    end
  end

  describe ".health" do
    let(:health_response) do
      {
        "status" => "ok",
        "enqueued_jobs" => 25,
        "failed_jobs" => 5,
        "active_workers" => 2
      }
    end

    it "returns health status with RQ metrics" do
      stub_request(:get, "#{base_url}/health/")
        .to_return(status: 200, body: health_response.to_json)

      result = described_class.health
      expect(result).to eq(health_response)
      expect(result["status"]).to eq("ok")
      expect(result["enqueued_jobs"]).to eq(25)
      expect(result["failed_jobs"]).to eq(5)
      expect(result["active_workers"]).to eq(2)
    end

    it "raises on failure" do
      stub_request(:get, "#{base_url}/health/")
        .to_return(status: 500, body: "Internal Server Error")

      expect {
        described_class.health
      }.to raise_error(KnowledgeService::Error, /failed/)
    end

    it "raises on timeout" do
      stub_request(:get, "#{base_url}/health/")
        .to_raise(Faraday::TimeoutError.new("timeout"))

      expect(LogService).to receive(:log).with(:error, "KnowledgeService", /Request timeout/)

      expect {
        described_class.health
      }.to raise_error(KnowledgeService::Error, /timed out after/)
    end
  end
end
