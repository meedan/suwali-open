require "rails_helper"

require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

RSpec.describe SourceIngestors::JsonApi, type: :service do
  before do
    allow(Resolv).to receive(:getaddresses).and_call_original
    allow(Resolv).to receive(:getaddresses).with("api.example.com").and_return(["93.184.216.34"])
  end

  let(:config) do
    {
      "base_url" => "https://api.example.com/articles",
      "pagination_start" => 1,
      "pagination_end" => 2,
      "page_param" => "page",
      "page_size_param" => "per_page",
      "page_size" => 2,
      "records_path" => "data.articles",
      "field_mappings" => {
        "title" => "headline",
        "content" => "body_text",
        "external_id" => "id",
        "url" => "permalink",
        "date" => "published_at"
      },
      "query_params" => {
        "api_key" => "test-key",
        "status" => "published"
      }
    }
  end

  let(:api_response_page_1) do
    {
      "data" => {
        "articles" => [
          {
            "id" => 1,
            "headline" => "First Article",
            "body_text" => "Content of the first article",
            "permalink" => "https://example.com/first-article",
            "published_at" => "2024-01-01T10:00:00Z",
            "author" => "John Doe"
          },
          {
            "id" => 2,
            "headline" => "Second Article",
            "body_text" => "Content of the second article",
            "permalink" => "https://example.com/second-article",
            "published_at" => "2024-01-02T11:00:00Z",
            "author" => "Jane Smith"
          }
        ]
      }
    }.to_json
  end

  let(:api_response_page_2) do
    {
      "data" => {
        "articles" => [
          {
            "id" => 3,
            "headline" => "Third Article",
            "body_text" => "Content of the third article",
            "permalink" => "https://example.com/third-article",
            "published_at" => "2024-01-03T12:00:00Z",
            "author" => "Bob Wilson"
          }
        ]
      }
    }.to_json
  end

  before do
    stub_request(:get, "https://api.example.com/articles")
      .with(query: {
        "page" => "1",
        "per_page" => "2",
        "api_key" => "test-key",
        "status" => "published"
      })
      .to_return(status: 200, body: api_response_page_1, headers: {"Content-Type" => "application/json"})

    stub_request(:get, "https://api.example.com/articles")
      .with(query: {
        "page" => "2",
        "per_page" => "2",
        "api_key" => "test-key",
        "status" => "published"
      })
      .to_return(status: 200, body: api_response_page_2, headers: {"Content-Type" => "application/json"})
  end

  describe "#call" do
    it "sends the configured User-Agent" do
      ingestor = described_class.new(config.merge(user_agent: "TestAgent/1.0"))

      ingestor.call

      expect(WebMock).to have_requested(:get, %r{\Ahttps://api\.example\.com/articles})
        .with(headers: {"User-Agent" => "TestAgent/1.0"}).at_least_once
    end

    it "fetches and parses JSON API responses correctly" do
      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(3)

      # First document
      doc1 = documents[0]
      expect(doc1[:external_id]).to eq("1")
      expect(doc1[:title]).to eq("First Article")
      expect(doc1[:content]).to eq("Content of the first article")
      expect(doc1[:metadata][:url]).to eq("https://example.com/first-article")
      expect(doc1[:document_type]).to eq("json")
      expect(doc1[:raw_data]["author"]).to eq("John Doe")

      # Second document
      doc2 = documents[1]
      expect(doc2[:external_id]).to eq("2")
      expect(doc2[:title]).to eq("Second Article")
      expect(doc2[:content]).to eq("Content of the second article")

      # Third document
      doc3 = documents[2]
      expect(doc3[:external_id]).to eq("3")
      expect(doc3[:title]).to eq("Third Article")
    end

    it "handles simple array responses without nested path" do
      simple_config = config.merge({
        "records_path" => "",
        "field_mappings" => {
          "title" => "title",
          "content" => "content",
          "external_id" => "id"
        }
      })

      simple_response = [
        {"id" => 1, "title" => "Article 1", "content" => "Content 1"},
        {"id" => 2, "title" => "Article 2", "content" => "Content 2"}
      ].to_json

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "1"))
        .to_return(status: 200, body: simple_response)

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
        .to_return(status: 200, body: "[]")

      ingestor = described_class.new(simple_config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
      expect(documents.first[:title]).to eq("Article 1")
    end

    it "stops pagination when no records are returned" do
      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
        .to_return(status: 200, body: '{"data": {"articles": []}}')

      ingestor = described_class.new(config.merge("pagination_end" => 10))
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
    end

    it "returns the total count even when it aborts pagination" do
      existing_scope = double("existing_scope")
      allow(existing_scope).to receive(:exists?).with(external_id: "1").and_return(true)
      deleted_scope = double("deleted_scope")
      allow(deleted_scope).to receive(:exists?).and_return(false)

      ingestor = described_class.new(config)
      documents, total = ingestor.call(
        existing_documents_scope: existing_scope,
        deleted_documents_scope: deleted_scope
      )

      expect(documents).to be_empty
      expect(total).to eq(2)
    end

    it "returns the total records seen across all visited pages when aborting mid-pagination" do
      existing_scope = double("existing_scope")
      allow(existing_scope).to receive(:exists?).and_return(false)
      allow(existing_scope).to receive(:exists?).with(external_id: "3").and_return(true)
      deleted_scope = double("deleted_scope")
      allow(deleted_scope).to receive(:exists?).and_return(false)

      ingestor = described_class.new(config)
      documents, total = ingestor.call(
        existing_documents_scope: existing_scope,
        deleted_documents_scope: deleted_scope
      )

      expect(documents.size).to eq(2)
      expect(total).to eq(3)
    end

    it "stops pagination when it encounters an already-imported record" do
      existing_scope = double("existing_scope")
      allow(existing_scope).to receive(:exists?).and_return(false)
      allow(existing_scope).to receive(:exists?).with(external_id: "1").and_return(true)
      deleted_scope = double("deleted_scope")
      allow(deleted_scope).to receive(:exists?).and_return(false)

      ingestor = described_class.new(config)
      ingestor.call(
        existing_documents_scope: existing_scope,
        deleted_documents_scope: deleted_scope
      )

      expect(WebMock).not_to have_requested(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
    end

    it "skips records with missing required fields" do
      invalid_response = {
        "data" => {
          "articles" => [
            {
              "id" => 1,
              "headline" => "Valid Article",
              "body_text" => "Valid content"
            },
            {
              "id" => 2,
              # Missing headline (title)
              "body_text" => "Content without title"
            },
            {
              # Missing id (external_id)
              "headline" => "Article without ID",
              "body_text" => "Content without ID"
            }
          ]
        }
      }.to_json

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "1"))
        .to_return(status: 200, body: invalid_response)

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
        .to_return(status: 200, body: '{"data": {"articles": []}}')

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      expect(documents.first[:title]).to eq("Valid Article")
    end

    it "counts skipped records toward the total" do
      page2_with_skips = {
        "data" => {
          "articles" => [
            {"id" => 3, "body_text" => "Content without title"},
            {"id" => 4, "body_text" => "Content without title"}
          ]
        }
      }.to_json

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
        .to_return(status: 200, body: page2_with_skips)

      ingestor = described_class.new(config)
      documents, total = ingestor.call

      expect(documents.size).to eq(2)
      expect(total).to eq(4)
    end

    it "returns empty array if base_url is blank" do
      expect(described_class.new({}).call).to eq([[], nil, nil, nil, nil])
      expect(described_class.new("base_url" => "").call).to eq([[], nil, nil, nil, nil])
      expect(described_class.new("base_url" => nil).call).to eq([[], nil, nil, nil, nil])
    end

    it "returns nil as suggested_name" do
      ingestor = described_class.new(config)
      _, _, suggested_name = ingestor.call

      expect(suggested_name).to be_nil
    end

    it "raises an error if API request fails" do
      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "1"))
        .to_return(status: 500, body: "Internal Server Error")

      ingestor = described_class.new(config)

      expect {
        ingestor.call
      }.to raise_error(/API request failed with status 500/)
    end

    it "raises an error if response is not valid JSON" do
      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "1"))
        .to_return(status: 200, body: "invalid json{")

      ingestor = described_class.new(config)

      expect {
        ingestor.call
      }.to raise_error(/Invalid JSON response/)
    end

    it "uses default pagination parameter names" do
      minimal_config = {
        "base_url" => "https://api.example.com/articles",
        "field_mappings" => {
          "title" => "title",
          "external_id" => "id"
        }
      }

      stub_request(:get, "https://api.example.com/articles")
        .with(query: {"page" => "1", "page_size" => "50"})
        .to_return(status: 200, body: "[]")

      ingestor = described_class.new(minimal_config)
      documents, _ = ingestor.call

      expect(documents).to eq([])
    end

    it "handles nested field mappings with dot notation" do
      nested_response = {
        "results" => [
          {
            "id" => 1,
            "attributes" => {
              "title" => "Nested Title",
              "content" => {
                "rendered" => "Nested content here"
              }
            },
            "meta" => {
              "url" => "https://example.com/nested"
            }
          }
        ]
      }.to_json

      nested_config = {
        "base_url" => "https://api.example.com/articles",
        "records_path" => "results",
        "field_mappings" => {
          "title" => "attributes.title",
          "content" => "attributes.content.rendered",
          "external_id" => "id",
          "url" => "meta.url"
        }
      }

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "1"))
        .to_return(status: 200, body: nested_response)

      stub_request(:get, "https://api.example.com/articles")
        .with(query: hash_including("page" => "2"))
        .to_return(status: 200, body: '{"results": []}')

      ingestor = described_class.new(nested_config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      expect(documents.first[:title]).to eq("Nested Title")
      expect(documents.first[:content]).to eq("Nested content here")
      expect(documents.first[:metadata][:url]).to eq("https://example.com/nested")
    end
  end

  describe "#as_file" do
    it "creates a JSON file with document data" do
      ingestor = described_class.new(config)
      doc_data = {
        title: "Test Article",
        content: "Test content",
        external_id: "123",
        date: Time.parse("2024-01-01T10:00:00Z"),
        metadata: {url: "https://example.com/test"},
        raw_data: {"original" => "data"}
      }

      file_path = ingestor.as_file(doc_data)

      expect(File.exist?(file_path)).to be(true)

      File.delete(file_path)
    end
  end
end
