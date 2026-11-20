require "rails_helper"

require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

RSpec.describe SourceIngestors::RssFeed, type: :service do
  let(:config) do
    {
      "feed_url" => "https://example.com/feed.xml"
    }
  end

  let(:rss_xml) do
    <<-XML
      <?xml version="1.0" encoding="UTF-8"?>
      <rss xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/" version="2.0">
        <channel>
          <title>Example Blog</title>
          <description>A test blog</description>
          <link>https://example.com</link>
          <item>
            <title>First Post</title>
            <description>&lt;p&gt;This is the first post description.&lt;/p&gt;</description>
            <link>https://example.com/posts/1</link>
            <guid>https://example.com/posts/1</guid>
            <pubDate>Mon, 01 Jan 2024 10:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Second Post</title>
            <description>This is the second post description.</description>
            <link>https://example.com/posts/2</link>
            <guid>post-2-guid</guid>
            <pubDate>Tue, 02 Jan 2024 11:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>
    XML
  end

  let(:full_article_html) do
    <<-HTML
      <html>
        <body>
          <article class="content">
            <h1>Full Article Title</h1>
            <p>This is the full article content with much more detail than the RSS description.</p>
            <p>Multiple paragraphs of content here.</p>
          </article>
        </body>
      </html>
    HTML
  end

  let(:full_article_html_with_non_content_tags) do
    <<-HTML
      <html>
        <head>
          <style>body { color: red; } .content { font-size: 14px; }</style>
        </head>
        <body>
          <article class="content">
            <style>.local { margin: 0; }</style>
            <script>console.log("tracking");</script>
            <noscript>Please enable JavaScript.</noscript>
            <h1>Full Article Title</h1>
            <p>This is the full article content.</p>
          </article>
        </body>
      </html>
    HTML
  end

  before do
    stub_request(:get, "https://example.com/feed.xml")
      .to_return(status: 200, body: rss_xml, headers: {"Content-Type" => "application/rss+xml"})
  end

  describe "#call" do
    it "fetches and parses RSS feed correctly" do
      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)

      first_doc = documents.first
      expect(first_doc[:external_id]).to eq("https://example.com/posts/1")
      expect(first_doc[:title]).to eq("First Post")
      expect(first_doc[:content]).to eq("This is the first post description.")
      expect(first_doc[:document_type]).to eq("rss_entry")

      second_doc = documents.last
      expect(second_doc[:external_id]).to eq("post-2-guid")
      expect(second_doc[:title]).to eq("Second Post")
      expect(second_doc[:content]).to eq("This is the second post description.")
      expect(second_doc[:metadata][:url]).to eq("https://example.com/posts/2")
    end

    it "sends the configured User-Agent" do
      ingestor = described_class.new(config.merge(user_agent: "TestAgent/1.0"))

      ingestor.call

      expect(WebMock).to have_requested(:get, "https://example.com/feed.xml")
        .with(headers: {"User-Agent" => "TestAgent/1.0"})
    end

    it "wraps errors raised while processing feed entries" do
      ingestor = described_class.new(config)
      allow(ingestor).to receive(:extract_rss_item_data).and_raise("boom")

      expect { ingestor.call }.to raise_error("Failed to process RSS feed https://example.com/feed.xml: boom")
    end

    it "strips HTML tags from descriptions" do
      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      first_doc = documents.first
      expect(first_doc[:content]).to eq("This is the first post description.")
      expect(first_doc[:content]).not_to include("<p>")
      expect(first_doc[:content]).not_to include("&lt;p&gt;")
    end

    it "expands descriptions when selector is provided" do
      config["expanded_description_selector"] = ".content"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)

      first_doc = documents.first
      expect(first_doc[:content]).to include("This is the first post description.")
      expect(first_doc[:content]).to include("This is the full article content with much more detail")
      expect(first_doc[:content]).to include("Multiple paragraphs of content here.")
    end

    it "strips style, script, and noscript tags from expanded article content" do
      config["expanded_description_selector"] = ".content"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html_with_non_content_tags)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html_with_non_content_tags)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      first_doc = documents.first
      expect(first_doc[:content]).to include("This is the full article content.")
      expect(first_doc[:content]).not_to include("color: red")
      expect(first_doc[:content]).not_to include("font-size")
      expect(first_doc[:content]).not_to include("margin")
      expect(first_doc[:content]).not_to include("console.log")
      expect(first_doc[:content]).not_to include("Please enable JavaScript")
    end

    it "continues with RSS description when article expansion fails" do
      config["expanded_description_selector"] = ".content"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 404)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 500)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
      expect(documents.first[:content]).to eq("This is the first post description.")
      expect(documents.last[:content]).to eq("This is the second post description.")
    end

    it "continues with RSS description when selector doesn't match" do
      config["expanded_description_selector"] = ".nonexistent-selector"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
      expect(documents.first[:content]).to eq("This is the first post description.")
      expect(documents.last[:content]).to eq("This is the second post description.")
    end

    it "handles RSS feeds without GUIDs" do
      rss_without_guid = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post without GUID</title>
              <description>Description here.</description>
              <link>https://example.com/posts/no-guid</link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_without_guid)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      expect(documents.first[:external_id]).to eq("https://example.com/posts/no-guid")
    end

    it "falls back to a title digest when an item has no GUID and no link" do
      rss_without_guid_or_link = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post without GUID or link</title>
              <description>Description here.</description>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_without_guid_or_link)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      # Pinned to the exact digest on purpose: external_id is the dedup key, so changing the hash
      # would silently re-import existing entries. This test is what makes that change loud.
      expect(documents.first[:external_id]).to eq(Digest::MD5.hexdigest("Post without GUID or link"))
    end

    it "skips items with blank titles and descriptions" do
      invalid_rss = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title></title>
              <description>Valid description</description>
              <link>https://example.com/posts/1</link>
            </item>
            <item>
              <title>Valid title</title>
              <description></description>
              <link>https://example.com/posts/2</link>
            </item>
            <item>
              <title>   </title>
              <description>   </description>
              <link>https://example.com/posts/3</link>
            </item>
            <item>
              <title>Valid Post</title>
              <description>Valid description</description>
              <link>https://example.com/posts/4</link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: invalid_rss)

      ingestor = described_class.new(config)
      documents, total = ingestor.call

      expect(total).to eq(4)
      expect(documents.size).to eq(3)
      expect(documents[0][:title]).to eq("Valid description")
      expect(documents[1][:title]).to eq("Valid title")
      expect(documents[2][:title]).to eq("Valid Post")
    end

    it "raises an error if RSS feed request fails" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 500)

      ingestor = described_class.new(config)

      expect {
        ingestor.call
      }.to raise_error(/Failed to fetch RSS feed.*500/)
    end

    it "raises an error if the URL does not return a parseable feed" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: "Not valid XML")

      ingestor = described_class.new(config)

      expect {
        ingestor.call
      }.to raise_error(/No RSS feed found/)
    end

    it "returns empty array if feed_url is blank" do
      expect(described_class.new({}).call).to eq([[], nil, nil, nil, nil])
      expect(described_class.new("feed_url" => "").call).to eq([[], nil, nil, nil, nil])
      expect(described_class.new("feed_url" => "   ").call).to eq([[], nil, nil, nil, nil])
      expect(described_class.new("feed_url" => nil).call).to eq([[], nil, nil, nil, nil])
    end

    it "returns the feed channel title as the suggested name when available" do
      ingestor = described_class.new(config)
      _, _, suggested_name = ingestor.call

      expect(suggested_name).to eq("Example Blog")
    end

    it "returns nil as the suggested_feed_url for a direct RSS feed URL" do
      ingestor = described_class.new(config)
      _, _, _, _, suggested_feed_url = ingestor.call

      expect(suggested_feed_url).to be_nil
    end

    it "returns the discovered feed URL as suggested_url when the input URL is an HTML page" do
      html_with_feed_link = <<-HTML
        <html>
          <head>
            <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" />
          </head>
          <body>Blog homepage</body>
        </html>
      HTML

      stub_request(:get, "https://example.com")
        .to_return(status: 200, body: html_with_feed_link, headers: {"Content-Type" => "text/html"})

      ingestor = described_class.new("feed_url" => "https://example.com")
      _, _, _, _, suggested_feed_url = ingestor.call

      expect(suggested_feed_url).to eq("https://example.com/feed.xml")
    end

    it "returns the feed URL as the suggested name when the channel has no title" do
      rss_without_title = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>First Post</title>
              <description>Description here.</description>
              <link>https://example.com/posts/1</link>
              <guid>https://example.com/posts/1</guid>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_without_title)

      ingestor = described_class.new(config)
      _, _, suggested_name = ingestor.call

      expect(suggested_name).to eq("https://example.com/feed.xml")
    end

    it "uses custom headers when provided" do
      config["headers"] = {"User-Agent" => "Test Bot"}

      stub_request(:get, "https://example.com/feed.xml")
        .with(headers: {"User-Agent" => "Test Bot"})
        .to_return(status: 200, body: rss_xml)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
    end

    it "handles blank links during expansion gracefully" do
      config["expanded_description_selector"] = ".content"

      rss_with_blank_link = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post without link</title>
              <description>Description here.</description>
              <link></link>
            </item>
            <item>
              <title>Post with whitespace link</title>
              <description>Another description.</description>
              <link>   </link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_blank_link)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(2)
      expect(documents.first[:content]).to eq("Description here.")
      expect(documents.last[:content]).to eq("Another description.")
    end
  end

  describe "#as_file" do
    it "creates a temporary file with RSS entry content including date" do
      ingestor = described_class.new(config)
      date = Time.parse("2024-01-01T10:00:00Z")
      doc_data = {
        title: "Test RSS Entry",
        content: "This is the RSS entry content.",
        date: date
      }

      file_path = ingestor.as_file(doc_data)

      expect(File.exist?(file_path)).to be(true)

      file_content = File.read(file_path)
      expect(file_content).to include("Test RSS Entry")
      expect(file_content).to include("Date: #{date}")
      expect(file_content).to include("This is the RSS entry content.")

      # Clean up
      File.delete(file_path) if File.exist?(file_path)
    end
  end

  describe "#refresh_supported?" do
    it "returns true when expanded_description_selector is configured" do
      config["expanded_description_selector"] = ".content"

      ingestor = described_class.new(config)

      expect(ingestor.refresh_supported?).to be(true)
    end

    it "returns false when expanded_description_selector is not configured" do
      ingestor = described_class.new(config)

      expect(ingestor.refresh_supported?).to be(false)
    end
  end

  describe "#refetch_document_data" do
    it "raises RefreshNotSupportedError when expanded_description_selector is not configured" do
      data = {url: "https://example.com/posts/1", title: "Old Title"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(Document::RefreshNotSupportedError)
    end

    it "returns freshly fetched content from the expanded description selector" do
      config["expanded_description_selector"] = ".content"
      stub_request(:get, "https://example.com/posts/1").to_return(status: 200, body: full_article_html)
      data = {url: "https://example.com/posts/1", title: "Old Title"}

      ingestor = described_class.new(config)
      doc_data = ingestor.refetch_document_data(data)

      expect(doc_data[:title]).to eq("Old Title")
      expect(doc_data[:content]).to include("This is the full article content with much more detail")
      expect(doc_data[:content]).to include("Multiple paragraphs of content here.")
    end

    it "raises when the article page fetch fails" do
      config["expanded_description_selector"] = ".content"
      stub_request(:get, "https://example.com/posts/1").to_return(status: 404)
      data = {url: "https://example.com/posts/1", title: "Old Title"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(/Could not extract updated content/)
    end

    it "raises when the selector no longer matches content on the fetched page" do
      config["expanded_description_selector"] = ".nonexistent-selector"
      stub_request(:get, "https://example.com/posts/1").to_return(status: 200, body: full_article_html)
      data = {url: "https://example.com/posts/1", title: "Old Title"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(/Could not extract updated content/)
    end
  end

  describe "content squishing and stripping" do
    it "squishes whitespace in descriptions" do
      rss_with_whitespace = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post with   extra    spaces</title>
              <description>  This   has    lots  of    whitespace   </description>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_whitespace)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      expect(documents.first[:title]).to eq("Post with extra spaces")
      expect(documents.first[:content]).to eq("This has lots of whitespace")
    end
  end

  describe "stops importing when it finds existing documents" do
    let(:existing_docs_scope) { double("Document scope") }
    let(:deleted_docs_scope) { double("DeletedDocument scope") }

    it "stops iterating when it encounters an already-imported record" do
      allow(existing_docs_scope).to receive(:exists?).and_return(false)
      allow(existing_docs_scope).to receive(:exists?).with(external_id: "https://example.com/posts/1").and_return(true)
      allow(deleted_docs_scope).to receive(:exists?).and_return(false)

      config["expanded_description_selector"] = ".content"
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)
      ingestor.call(
        existing_documents_scope: existing_docs_scope,
        deleted_documents_scope: deleted_docs_scope
      )

      expect(WebMock).not_to have_requested(:get, "https://example.com/posts/2")
    end

    it "returns the total count even when it aborts" do
      allow(existing_docs_scope).to receive(:exists?).and_return(true)
      allow(deleted_docs_scope).to receive(:exists?).and_return(false)

      ingestor = described_class.new(config)
      documents, total = ingestor.call(
        existing_documents_scope: existing_docs_scope,
        deleted_documents_scope: deleted_docs_scope
      )

      expect(documents).to be_empty
      expect(total).to eq(2)
    end
  end

  describe "content:encoded handling" do
    it "uses content:encoded when no expanded_description_selector is provided" do
      rss_with_content_encoded = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post with content:encoded</title>
              <description>Short description</description>
              <content:encoded><![CDATA[<p>This is the <strong>full content</strong> from content:encoded with HTML tags.</p>]]></content:encoded>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_content_encoded)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      first_doc = documents.first
      expect(first_doc[:content]).to include("Short description")
      expect(first_doc[:content]).to include("This is the full content from content:encoded with HTML tags.")
      expect(first_doc[:content]).not_to include("<p>")
      expect(first_doc[:content]).not_to include("<strong>")
    end

    it "ignores content:encoded when expanded_description_selector is provided" do
      config["expanded_description_selector"] = ".content"

      rss_with_content_encoded = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post with content:encoded</title>
              <description>Short description</description>
              <content:encoded><![CDATA[<p>This should be ignored when selector is provided.</p>]]></content:encoded>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_content_encoded)
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)
      documents, _ = ingestor.call

      expect(documents.size).to eq(1)
      first_doc = documents.first
      expect(first_doc[:content]).to include("This is the full article content with much more detail")
      expect(first_doc[:content]).not_to include("This should be ignored when selector is provided")
    end
  end

  describe "#preview" do
    it "raises immediately without fetching any article page when the selector syntax is invalid" do
      config["expanded_description_selector"] = "[unclosed"

      ingestor = described_class.new(config)

      expect {
        ingestor.preview
      }.to raise_error(/invalid css selector/i)

      expect(WebMock).not_to have_requested(:get, "https://example.com/posts/1")
      expect(WebMock).not_to have_requested(:get, "https://example.com/posts/2")
    end

    it "raises after only the first successfully-loaded page and does not fetch subsequent pages" do
      config["expanded_description_selector"] = ".nonexistent-selector"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)

      expect {
        ingestor.preview
      }.to raise_error(/selector.*did not match/i)

      expect(WebMock).to have_requested(:get, "https://example.com/posts/1").once
      expect(WebMock).not_to have_requested(:get, "https://example.com/posts/2")
    end

    it "succeeds when the selector matches at least one article page" do
      config["expanded_description_selector"] = ".content"

      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: full_article_html)
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: full_article_html)

      ingestor = described_class.new(config)
      documents, _ = ingestor.preview

      expect(documents.first[:content]).to include("This is the full article content")
    end

    it "raises when all article pages fail to load and the selector could not be tested" do
      config["expanded_description_selector"] = ".content"

      stub_request(:get, "https://example.com/posts/1").to_return(status: 404)
      stub_request(:get, "https://example.com/posts/2").to_return(status: 500)

      ingestor = described_class.new(config)

      expect {
        ingestor.preview
      }.to raise_error(/could not be tested/i)
    end

    it "returns at most PREVIEW_LIMIT documents" do
      large_rss_xml = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            #{(1..6).map { |i| "<item><title>Post #{i}</title><description>Description #{i}.</description><link>https://example.com/posts/#{i}</link><guid>https://example.com/posts/#{i}</guid></item>" }.join("\n")}
          </channel>
        </rss>
      XML

      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: large_rss_xml)

      ingestor = described_class.new(config)
      documents, _ = ingestor.preview

      expect(documents.size).to eq(described_class::PREVIEW_LIMIT)
    end

    it "returns nil as the suggested_feed_url for a direct RSS feed URL" do
      ingestor = described_class.new(config)
      _, _, _, _, suggested_feed_url = ingestor.preview

      expect(suggested_feed_url).to be_nil
    end

    it "returns the discovered feed URL as the suggested_feed_url when the input URL is an HTML page" do
      html_with_feed_link = <<-HTML
        <html>
          <head>
            <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" />
          </head>
          <body>Blog homepage</body>
        </html>
      HTML

      stub_request(:get, "https://example.com")
        .to_return(status: 200, body: html_with_feed_link, headers: {"Content-Type" => "text/html"})

      ingestor = described_class.new("feed_url" => "https://example.com")
      _, _, _, _, suggested_feed_url = ingestor.preview

      expect(suggested_feed_url).to eq("https://example.com/feed.xml")
    end
  end

  describe "#resolve_feed" do
    it "makes a request to the url" do
      ingestor = described_class.new(config)
      ingestor.send(:resolve_feed)

      expect(WebMock).to have_requested(:get, "https://example.com/feed.xml")
    end

    it "handles invalid url correctly" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 403)

      ingestor = described_class.new(config)
      expect { ingestor.send(:resolve_feed) }.to raise_error(/Failed to fetch RSS feed.*403/)
    end

    context "when the url points to an HTML page with a feed link" do
      let(:html_with_feed_link) do
        <<-HTML
          <html>
            <head>
              <link rel="alternate" type="application/rss+xml" href="https://example.com/feed.xml" />
            </head>
            <body>Blog homepage</body>
          </html>
        HTML
      end

      before do
        config["feed_url"] = "https://example.com"
        stub_request(:get, "https://example.com")
          .to_return(status: 200, body: html_with_feed_link, headers: {"Content-Type" => "text/html"})
      end

      it "makes a request to the feed link found in the page" do
        described_class.new(config).send(:resolve_feed)

        expect(WebMock).to have_requested(:get, "https://example.com/feed.xml")
      end

      it "returns a parsed feed" do
        feed, _ = described_class.new(config).send(:resolve_feed)

        expect(feed.title).to eq("Example Blog")
        expect(feed.entries.count).to eq(2)
      end

      it "returns the discovered feed url" do
        _, suggested_feed_url = described_class.new(config).send(:resolve_feed)

        expect(suggested_feed_url).to eq("https://example.com/feed.xml")
      end

      context "when no feed link is present" do
        before do
          stub_request(:get, "https://example.com")
            .to_return(status: 200, body: "<html><body>No feed here</body></html>", headers: {"Content-Type" => "text/html"})
        end

        it "raises" do
          expect { described_class.new(config).send(:resolve_feed) }.to raise_error(/No RSS feed found at/)
        end
      end
    end

    it "returns a parsed feed when the url points directly to a feed" do
      feed, suggested_feed_url = described_class.new(config).send(:resolve_feed)

      expect(feed.title).to eq("Example Blog")
      expect(feed.entries.count).to eq(2)
      expect(suggested_feed_url).to be_nil
      expect(WebMock).to have_requested(:get, "https://example.com/feed.xml").once
    end
  end

  describe "#configure" do
    let(:rss_with_content_encoded) do
      <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>Post with content:encoded</title>
              <description>Short description</description>
              <content:encoded><![CDATA[<p>One morning, when Gregor Samsa woke from troubled dreams, he found himself transformed in his bed into a horrible vermin. He lay on his armour-like back, and if he lifted his head a little he could see his brown belly, slightly domed and divided by arches into stiff sections. The bedding was hardly able to cover it and seemed ready to slide off any moment. His many legs, pitifully thin compared with the size of the rest of him, waved about helplessly as he looked. "What's happened to me?" he thought. It wasn't a dream. His room, a proper human room although a little too small, lay peacefully between its four familiar walls. A collection of textile samples lay spread out on the table - Samsa was a travelling salesman - and above it there hung a picture that he had recently cut out of an illustrated magazine and housed in a nice, gilded frame. It showed a lady fitted out with a fur hat and fur boa who sat upright, raising a heavy fur muff that covered the whole of her lower arm towards th</p>]]></content:encoded>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML
    end

    let(:rss_with_long_description) do
      <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>First Post</title>
              <description>One morning, when Gregor Samsa woke from troubled dreams, he found himself transformed in his bed into a horrible vermin. He lay on his armour-like back, and if he lifted his head a little he could see his brown belly, slightly domed and divided by arches into stiff sections. The bedding was hardly able to cover it and seemed ready to slide off any moment. His many legs, pitifully thin compared with the size of the rest of him, waved about helplessly as he looked. "What's happened to me?" he thought. It wasn't a dream. His room, a proper human room although a little too small, lay peacefully between its four familiar walls. A collection of textile samples lay spread out on the table - Samsa was a travelling salesman - and above it there hung a picture that he had recently cut out of an illustrated magazine and housed in a nice, gilded frame. It showed a lady fitted out with a fur hat and fur boa who sat upright, raising a heavy fur muff that covered the whole of her lower arm towards th</description>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML
    end

    let(:rss_without_rich_tags) do
      <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <link>https://example.com</link>
            <description>A test blog</description>
            <item>
              <title>First Post</title>
              <description>Short description</description>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML
    end

    it "raises an error if the feed cannot be fetched" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 500)

      ingestor = described_class.new(config)

      expect {
        ingestor.configure
      }.to raise_error(/Failed to fetch RSS feed.*500/)
    end

    it "returns type: feed when content:encoded contains the full article" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_content_encoded)

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to eq("feed")
      expect(config_sugestion[:selectors]).to eq({})
    end

    it "falls through to CSS selector when content:encoded is too short" do
      short_content_encoded_xml = <<-XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
          <channel>
            <title>Example Blog</title>
            <item>
              <title>Post</title>
              <content:encoded><![CDATA[<p>Short content.</p>]]></content:encoded>
              <link>https://example.com/posts/1</link>
            </item>
          </channel>
        </rss>
      XML
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: short_content_encoded_xml)
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: "<html><body><article class='content'>Article</article></body></html>")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_body).and_return(".content")

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to eq("css")
      expect(config_sugestion[:selectors]).to eq({body: ".content"})
    end

    it "returns type: feed when the feed description contains the full article" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_with_long_description)

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to eq("feed")
      expect(config_sugestion[:selectors]).to eq({})
    end

    it "returns type: css with the selector when the article page has identifiable content" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_without_rich_tags)
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: "<html><body><article class='content'>Article</article></body></html>")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_body).and_return(".content")

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to eq("css")
      expect(config_sugestion[:selectors]).to eq({body: ".content"})
    end

    it "returns type: nil when the feed has no entries" do
      empty_feed_xml = <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Empty Feed</title>
          </channel>
        </rss>
      XML
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: empty_feed_xml)

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to be_nil
      expect(config_sugestion[:selectors]).to eq({})
    end

    it "returns type: nil when the feed entry has no link" do
      no_link_xml = <<~XML
        <?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Example Blog</title>
            <item>
              <title>Post</title>
              <description>Short description</description>
            </item>
          </channel>
        </rss>
      XML
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: no_link_xml)

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to be_nil
      expect(config_sugestion[:selectors]).to eq({})
    end

    it "returns type: nil when no selector could be determined" do
      stub_request(:get, "https://example.com/feed.xml")
        .to_return(status: 200, body: rss_without_rich_tags)
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: "<html><body><article class='content'>Article</article></body></html>")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_body).and_return(nil)

      ingestor = described_class.new(config)
      config_sugestion = ingestor.configure
      expect(config_sugestion[:type]).to be_nil
      expect(config_sugestion[:selectors]).to eq({})
    end
  end
end
