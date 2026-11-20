require_relative "../unit_spec_helper"
require_relative "../../app/services/webhook_services/base_service"

# Test subclass to access protected methods
class TestService < WebhookServices::BaseService
  def valid?
    true
  end

  def process
    true
  end

  def platform_name
    "test"
  end

  # Expose protected method for testing
  public :format_sources_message_text
end

RSpec.describe WebhookServices::BaseService do
  it "can't be called directly" do
    service = described_class.new({})
    expect { service.valid? }.to raise_error(NotImplementedError)
    expect { service.process }.to raise_error(NotImplementedError)
    expect { service.send(:platform_name) }.to raise_error(NotImplementedError)
  end

  describe "#format_sources_message_text" do
    let(:service) { TestService.new({}) }

    it "ensures unique external_urls in the output" do
      # Mock I18n for the test
      i18n_double = double("I18n")
      stub_const("I18n", i18n_double)
      allow(i18n_double).to receive(:t).with(:message_no_public_sources_available_for_answer).and_return("No sources available")
      allow(i18n_double).to receive(:with_locale).and_yield

      # Create mock source
      source = double("Source", source_type: "rss_feed")

      # Create mock documents with the same external_url
      document1 = double("Document",
        title: "First Article",
        content_snippet: "First article snippet",
        external_url: "https://example.com/article",
        source: source,
        active: true)

      document2 = double("Document",
        title: "Second Article (duplicate URL)",
        content_snippet: "Second article snippet",
        external_url: "https://example.com/article", # Same URL as document1
        source: source,
        active: true)

      document3 = double("Document",
        title: "Third Article",
        content_snippet: "Third article snippet",
        external_url: "https://example.com/different-article",
        source: source,
        active: true)

      # Create mock message_data_source_items
      mdsi1 = double("MessageDataSourceItem",
        is_public_source_document?: true,
        item: document1)

      mdsi2 = double("MessageDataSourceItem",
        is_public_source_document?: true,
        item: document2)

      mdsi3 = double("MessageDataSourceItem",
        is_public_source_document?: true,
        item: document3)

      # Create mock message
      message = double("Message")
      allow(message).to receive(:message_data_source_items).and_return([mdsi1, mdsi2, mdsi3])

      # Call the method
      result = service.format_sources_message_text(message)

      # Verify that the result contains only unique URLs
      # Should have 2 sources (document1/document2 deduplicated, and document3)
      expect(result.scan("https://example.com/article").count).to eq(1)
      expect(result.scan("https://example.com/different-article").count).to eq(1)

      # Verify the first occurrence is kept (First Article, not Second Article)
      expect(result).to include("First Article")
      expect(result).not_to include("Second Article")
      expect(result).to include("Third Article")

      # Verify format: title\nsnippet\nurl with double newlines between entries
      expect(result).to include("First Article\nFirst article snippet\nhttps://example.com/article")
      expect(result).to include("Third Article\nThird article snippet\nhttps://example.com/different-article")
    end

    it "omits the snippet line when a document has no content" do
      i18n_double = double("I18n")
      stub_const("I18n", i18n_double)
      allow(i18n_double).to receive(:with_locale).and_yield

      source = double("Source", source_type: "rss_feed")
      document = double("Document",
        title: "No Content Article",
        content_snippet: "",
        external_url: "https://example.com/article",
        source: source,
        active: true)
      mdsi = double("MessageDataSourceItem", is_public_source_document?: true, item: document)
      message = double("Message")
      allow(message).to receive(:message_data_source_items).and_return([mdsi])

      result = service.format_sources_message_text(message)

      expect(result).to eq("No Content Article\nhttps://example.com/article")
    end

    it "falls back to title and URL only when the snippets would overflow the message limit" do
      i18n_double = double("I18n")
      stub_const("I18n", i18n_double)
      allow(i18n_double).to receive(:with_locale).and_yield

      source = double("Source", source_type: "rss_feed")
      documents = (1..10).map do |i|
        double("Document",
          title: "Article #{i}",
          content_snippet: "x" * 500,
          external_url: "https://example.com/article-#{i}",
          source: source,
          active: true)
      end
      mdsis = documents.map { |document| double("MessageDataSourceItem", is_public_source_document?: true, item: document) }
      message = double("Message")
      allow(message).to receive(:message_data_source_items).and_return(mdsis)

      result = service.format_sources_message_text(message)

      expect(result.length).to be <= WebhookServices::BaseService::MAX_TEXT_MESSAGE_LENGTH
      expect(result).not_to include("x" * 500)
      expect(result).to include("Article 1\nhttps://example.com/article-1")
      expect(result).to include("Article 10\nhttps://example.com/article-10")
    end

    it "returns message when no sources are available" do
      # Mock I18n for the test
      i18n_double = double("I18n")
      stub_const("I18n", i18n_double)
      allow(i18n_double).to receive(:t).with(:message_no_public_sources_available_for_answer).and_return("No sources available")
      allow(i18n_double).to receive(:with_locale).and_yield

      # Create mock message with no message_data_source_items
      conversation = double("Conversation", language: "en")
      message = double("Message", conversation: conversation)
      allow(message).to receive(:message_data_source_items).and_return([])

      # Call the method
      result = service.format_sources_message_text(message)

      # Verify that it returns the "no sources" message
      expect(result).to eq("No sources available")
    end

    it "filters out non-public sources" do
      # Mock I18n for the test
      i18n_double = double("I18n")
      stub_const("I18n", i18n_double)
      allow(i18n_double).to receive(:t).with(:message_no_public_sources_available_for_answer).and_return("No sources available")
      allow(i18n_double).to receive(:with_locale).and_yield

      # Create mock sources
      public_source = double("Source", source_type: "rss_feed")
      private_source = double("Source", source_type: "google_drive")

      # Create mock documents
      public_document = double("Document",
        title: "Public Article",
        content_snippet: "Public article snippet",
        external_url: "https://example.com/public",
        source: public_source,
        active: true)

      private_document = double("Document",
        title: "Private Document",
        external_url: "https://drive.google.com/file/123",
        source: private_source,
        active: true)

      # Create mock message_data_source_items
      mdsi1 = double("MessageDataSourceItem",
        is_public_source_document?: true,
        item: public_document)

      mdsi2 = double("MessageDataSourceItem",
        is_public_source_document?: false,
        item: private_document)

      # Create mock message
      message = double("Message")
      allow(message).to receive(:message_data_source_items).and_return([mdsi1, mdsi2])

      # Call the method
      result = service.format_sources_message_text(message)

      # Verify that only public sources are included
      expect(result).to include("Public Article")
      expect(result).not_to include("Private Document")
      expect(result).to include("https://example.com/public")
      expect(result).not_to include("https://drive.google.com/file/123")
    end
  end
end
