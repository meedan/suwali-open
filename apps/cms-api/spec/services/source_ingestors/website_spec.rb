require_relative "../../unit_spec_helper"
require_relative "../../../app/services/source_ingestors/website"

require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

RSpec.describe SourceIngestors::Website do
  let(:config) do
    {
      "base_url" => "https://example.com/posts?page={page}",
      "pagination_start" => 1,
      "pagination_end" => 1,
      "post_link_selector" => ".post-link",
      "title_selector" => "h1.title",
      "body_selector" => "div.body",
      "total_selector" => "span.number-of-total-results"
    }
  end

  let(:listing_html) do
    <<-HTML
      <html>
        <body>
          <a class="post-link" href="/posts/1">Post 1</a>
          <a class="post-link" href="/posts/2">Post 2</a>
        </body>
      </html>
    HTML
  end

  let(:post_html) do
    <<-HTML
      <html>
        <body>
          <h1 class="title">Example Post</h1>
          <div class="body">This is the body content.</div>
        </body>
      </html>
    HTML
  end

  let(:post_html_with_non_content_tags) do
    <<-HTML
      <html>
        <head>
          <style>body { color: red; } h1 { font-size: 24px; }</style>
        </head>
        <body>
          <h1 class="title">Example Post</h1>
          <div class="body">
            <style>.local { margin: 0; }</style>
            <script>trackPageView();</script>
            <noscript>Please enable JavaScript.</noscript>
            This is the body content.
          </div>
        </body>
      </html>
    HTML
  end

  before do
    stub_request(:get, "https://example.com/posts?page=1")
      .to_return(status: 200, body: listing_html)

    stub_request(:get, "https://example.com/posts/1")
      .to_return(status: 200, body: post_html)

    stub_request(:get, "https://example.com/posts/2")
      .to_return(status: 200, body: post_html)
  end

  describe "#preview" do
    it "returns at most PREVIEW_LIMIT documents and stops fetching early" do
      listing_html_many = <<-HTML
        <html>
          <body>
            <a class="post-link" href="/posts/1">Post 1</a>
            <a class="post-link" href="/posts/2">Post 2</a>
            <a class="post-link" href="/posts/3">Post 3</a>
            <a class="post-link" href="/posts/4">Post 4</a>
            <a class="post-link" href="/posts/5">Post 5</a>
            <a class="post-link" href="/posts/6">Post 6</a>
          </body>
        </html>
      HTML

      stub_request(:get, "https://example.com/posts?page=1")
        .to_return(status: 200, body: listing_html_many)
      (1..6).each do |i|
        stub_request(:get, "https://example.com/posts/#{i}")
          .to_return(status: 200, body: post_html)
      end

      ingestor = described_class.new(config)
      documents, _ = ingestor.preview

      expect(documents.size).to eq(described_class::PREVIEW_LIMIT)
      expect(WebMock).not_to have_requested(:get, "https://example.com/posts/6")
    end

    it "raises on an invalid CSS selector before making any requests" do
      ingestor = described_class.new(config.merge("post_link_selector" => "[unclosed"))
      expect { ingestor.preview }.to raise_error(/Invalid CSS selector/)
      expect(WebMock).not_to have_requested(:get, "https://example.com/posts?page=1")
    end

    it "raises when post_link_selector finds no links on the listing page" do
      stub_request(:get, "https://example.com/posts?page=1")
        .to_return(status: 200, body: "<html><body><p>no links here</p></body></html>")
      ingestor = described_class.new(config)
      expect { ingestor.preview }.to raise_error(/did not match any links/)
    end

    it "follows links when the post_link_selector targets a container element rather than the anchor" do
      container_listing = <<-HTML
        <html>
          <body>
            <article class="post-card"><a href="/posts/1">Post 1</a></article>
            <article class="post-card"><a href="/posts/2">Post 2</a></article>
          </body>
        </html>
      HTML

      stub_request(:get, "https://example.com/posts?page=1")
        .to_return(status: 200, body: container_listing)

      ingestor = described_class.new(config.merge("post_link_selector" => "article.post-card"))
      documents, _ = ingestor.preview

      expect(documents.size).to eq(2)
    end

    it "raises when title or body selectors find no content on post pages" do
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: "<html><body><p>no matching selectors here</p></body></html>")
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 200, body: "<html><body><p>no matching selectors here</p></body></html>")
      ingestor = described_class.new(config)
      expect { ingestor.preview }.to raise_error(/did not match any content/)
    end

    it "raises when a post page fails to load" do
      stub_request(:get, "https://example.com/posts/2")
        .to_return(status: 403)
      ingestor = described_class.new(config)
      expect { ingestor.preview }.to raise_error(SourceIngestors::HttpClient::FetchFailedError, /Failed to fetch/)
    end
  end

  it "fetches, counts and parses posts correctly" do
    ingestor = described_class.new(config)
    documents, total = ingestor.call

    expect(documents.size).to eq(2)
    expect(total).to eq(2)

    doc = documents.first
    expect(doc[:external_id]).to eq("https://example.com/posts/1")
    expect(doc[:title]).to eq("Example Post")
    expect(doc[:content]).to include("This is the body content.")
    expect(doc[:metadata][:url]).to eq("https://example.com/posts/1")
    expect(doc[:document_type]).to eq("blog_post")
  end

  it "sends the configured User-Agent" do
    ingestor = described_class.new(config.merge(user_agent: "TestAgent/1.0"))

    ingestor.call

    expect(WebMock).to have_requested(:get, "https://example.com/posts?page=1")
      .with(headers: {"User-Agent" => "TestAgent/1.0"})
  end

  it "strips style, script, and noscript tags from post content" do
    stub_request(:get, "https://example.com/posts/1")
      .to_return(status: 200, body: post_html_with_non_content_tags)
    stub_request(:get, "https://example.com/posts/2")
      .to_return(status: 200, body: post_html_with_non_content_tags)

    ingestor = described_class.new(config)
    documents, _ = ingestor.call

    doc = documents.first
    expect(doc[:content]).to include("This is the body content.")
    expect(doc[:content]).not_to include("color: red")
    expect(doc[:content]).not_to include("font-size")
    expect(doc[:content]).not_to include("margin")
    expect(doc[:content]).not_to include("trackPageView")
    expect(doc[:content]).not_to include("Please enable JavaScript")
  end

  it "raises an error if a page returns failure" do
    stub_request(:get, "https://example.com/posts?page=1")
      .to_return(status: 500)

    ingestor = described_class.new(config)

    expect {
      ingestor.call
    }.to raise_error(SourceIngestors::HttpClient::FetchFailedError, /Failed to fetch/)
  end

  it "stops paginating and keeps collected documents when a later listing page fails" do
    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 404)

    ingestor = described_class.new(config.merge("pagination_end" => 3))
    documents, _, _, errors = ingestor.call

    expect(documents.size).to eq(2)
    expect(errors).to be_empty
    expect(WebMock).not_to have_requested(:get, "https://example.com/posts?page=3")
  end

  it "raises when a later listing page fails with a non-404 error" do
    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 500)

    ingestor = described_class.new(config.merge("pagination_end" => 2))

    expect { ingestor.call }.to raise_error(SourceIngestors::HttpClient::FetchFailedError, /500/)
  end

  it "records posts that fail to load as errors and still returns the others" do
    stub_request(:get, "https://example.com/posts/2")
      .to_return(status: 403)

    ingestor = described_class.new(config)
    documents, _, _, errors = ingestor.call

    expect(documents.map { |doc| doc[:external_id] }).to eq(["https://example.com/posts/1"])
    expect(errors).to contain_exactly(hash_including(
      external_id: "https://example.com/posts/2",
      link: "https://example.com/posts/2",
      reason: "fetch_failed",
      details: a_string_including("403")
    ))
  end

  it "saves files" do
    ingestor = described_class.new(config)
    path = ingestor.as_file({title: "Foo", content: "Bar"})
    expect(File.exist?(path)).to be(true)
  end

  it "returns the page title as the suggested name when available" do
    listing_with_title = <<-HTML
      <html>
        <head><title>My Example Blog</title></head>
        <body>
          <a class="post-link" href="/posts/1">Post 1</a>
          <a class="post-link" href="/posts/2">Post 2</a>
        </body>
      </html>
    HTML

    stub_request(:get, "https://example.com/posts?page=1")
      .to_return(status: 200, body: listing_with_title)

    ingestor = described_class.new(config)
    _, _, suggested_name = ingestor.call

    expect(suggested_name).to eq("My Example Blog")
  end

  it "returns the base URL as the suggested name when no page title is found" do
    ingestor = described_class.new(config)
    _, _, suggested_name = ingestor.call

    expect(suggested_name).to eq("https://example.com/posts?page={page}")
  end

  describe "skipping existing documents" do
    let(:existing_docs_scope) { double("Document scope") }
    let(:deleted_docs_scope) { double("DeletedDocument scope") }

    context "when external_id_selector is provided" do
      let(:post_html_with_id) do
        <<-HTML
          <html>
            <body>
              <span class="post-id">custom-id-123</span>
              <h1 class="title">Example Post</h1>
              <div class="body">This is the body content.</div>
            </body>
          </html>
        HTML
      end

      before do
        config["external_id_selector"] = ".post-id"
        stub_request(:get, "https://example.com/posts/1")
          .to_return(status: 200, body: post_html_with_id)
        stub_request(:get, "https://example.com/posts/2")
          .to_return(status: 200, body: post_html_with_id)
      end

      it "skips posts that already exist in Document" do
        allow(existing_docs_scope).to receive(:exists?).with(external_id: "custom-id-123").and_return(true)
        allow(deleted_docs_scope).to receive(:exists?).and_return(false)

        ingestor = described_class.new(config)
        documents, _ = ingestor.call(
          existing_documents_scope: existing_docs_scope,
          deleted_documents_scope: deleted_docs_scope
        )

        expect(documents).to be_empty
      end

      it "skips posts that exist in DeletedDocument" do
        allow(existing_docs_scope).to receive(:exists?).and_return(false)
        allow(deleted_docs_scope).to receive(:exists?).with(external_id: "custom-id-123").and_return(true)

        ingestor = described_class.new(config)
        documents, _ = ingestor.call(
          existing_documents_scope: existing_docs_scope,
          deleted_documents_scope: deleted_docs_scope
        )

        expect(documents).to be_empty
      end

      it "includes posts that don't exist" do
        allow(existing_docs_scope).to receive(:exists?).and_return(false)
        allow(deleted_docs_scope).to receive(:exists?).and_return(false)

        ingestor = described_class.new(config)
        documents, _ = ingestor.call(
          existing_documents_scope: existing_docs_scope,
          deleted_documents_scope: deleted_docs_scope
        )

        expect(documents.size).to eq(2)
        expect(documents.first[:external_id]).to eq("custom-id-123")
      end
    end

    context "when no external_id_selector (URL is external_id)" do
      it "continues importing when no external_id_selector and item was not previously imported" do
        allow(existing_docs_scope).to receive(:exists?).and_return(false)
        allow(deleted_docs_scope).to receive(:exists?).and_return(false)

        ingestor = described_class.new(config)
        documents, _ = ingestor.call(
          existing_documents_scope: existing_docs_scope,
          deleted_documents_scope: deleted_docs_scope
        )

        expect(documents.size).to eq(2)
      end
    end
  end

  it "stops pagination when it encounters an already-imported record" do
    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 200, body: listing_html)

    existing_scope = double("existing_scope")
    allow(existing_scope).to receive(:exists?).and_return(false)
    allow(existing_scope).to receive(:exists?).with(external_id: "https://example.com/posts/1").and_return(true)
    deleted_scope = double("deleted_scope")
    allow(deleted_scope).to receive(:exists?).and_return(false)

    ingestor = described_class.new(config.merge("pagination_end" => 2))
    ingestor.call(
      existing_documents_scope: existing_scope,
      deleted_documents_scope: deleted_scope
    )

    expect(WebMock).not_to have_requested(:get, "https://example.com/posts?page=2")
  end

  it "returns the total count even when it aborts pagination" do
    existing_scope = double("existing_scope")
    allow(existing_scope).to receive(:exists?).and_return(true)
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

  it "returns the total links seen across all visited pages when aborting mid-pagination" do
    listing_html_page2 = <<-HTML
      <html>
        <body>
          <a class="post-link" href="/posts/3">Post 3</a>
          <a class="post-link" href="/posts/4">Post 4</a>
        </body>
      </html>
    HTML

    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 200, body: listing_html_page2)
    stub_request(:get, "https://example.com/posts/3")
      .to_return(status: 200, body: post_html)

    existing_scope = double("existing_scope")
    allow(existing_scope).to receive(:exists?).and_return(false)
    allow(existing_scope).to receive(:exists?).with(external_id: "https://example.com/posts/3").and_return(true)
    deleted_scope = double("deleted_scope")
    allow(deleted_scope).to receive(:exists?).and_return(false)

    ingestor = described_class.new(config.merge("pagination_end" => 2))
    documents, total = ingestor.call(
      existing_documents_scope: existing_scope,
      deleted_documents_scope: deleted_scope
    )

    # page 1 imported fully (2 docs), page 2 listing was fetched (2 links) before aborting
    expect(documents.size).to eq(2)
    expect(total).to eq(4)
  end

  it "counts skipped posts toward the total" do
    post_html_no_body = <<-HTML
      <html>
        <body>
          <h1 class="title">Example Post</h1>
          <div class="body"></div>
        </body>
      </html>
    HTML

    listing_html_page2 = <<-HTML
      <html>
        <body>
          <a class="post-link" href="/posts/3">Post 3</a>
          <a class="post-link" href="/posts/4">Post 4</a>
        </body>
      </html>
    HTML

    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 200, body: listing_html_page2)
    stub_request(:get, "https://example.com/posts/3")
      .to_return(status: 200, body: post_html_no_body)
    stub_request(:get, "https://example.com/posts/4")
      .to_return(status: 200, body: post_html_no_body)

    ingestor = described_class.new(config.merge("pagination_end" => 2))
    documents, total = ingestor.call

    # page 1 imports 2 docs, page 2 has 2 links but both are skipped
    expect(documents.size).to eq(2)
    expect(total).to eq(4)
  end

  it "returns the actual document count when pagination yields more than the page-1 fallback total" do
    listing_html_page2 = <<-HTML
      <html>
        <body>
          <a class="post-link" href="/posts/3">Post 3</a>
          <a class="post-link" href="/posts/4">Post 4</a>
        </body>
      </html>
    HTML

    stub_request(:get, "https://example.com/posts?page=2")
      .to_return(status: 200, body: listing_html_page2)
    stub_request(:get, "https://example.com/posts/3")
      .to_return(status: 200, body: post_html)
    stub_request(:get, "https://example.com/posts/4")
      .to_return(status: 200, body: post_html)

    ingestor = described_class.new(config.merge("pagination_end" => 2))
    documents, total = ingestor.call

    expect(documents.size).to eq(4)
    expect(total).to eq(4)
  end

  describe "#refresh_supported?" do
    it "returns true" do
      ingestor = described_class.new(config)

      expect(ingestor.refresh_supported?).to be(true)
    end
  end

  describe "#refetch_document_data" do
    it "returns freshly scraped title and content for the document's stored URL" do
      updated_post_html = <<-HTML
        <html>
          <body>
            <h1 class="title">Updated Post</h1>
            <div class="body">This is the updated body content.</div>
          </body>
        </html>
      HTML
      stub_request(:get, "https://example.com/posts/1").to_return(status: 200, body: updated_post_html)
      data = {url: "https://example.com/posts/1"}

      ingestor = described_class.new(config)
      doc_data = ingestor.refetch_document_data(data)

      expect(doc_data[:title]).to eq("Updated Post")
      expect(doc_data[:content]).to include("This is the updated body content.")
    end

    it "raises when the page fetch fails" do
      stub_request(:get, "https://example.com/posts/1").to_return(status: 500)
      data = {url: "https://example.com/posts/1"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(SourceIngestors::HttpClient::FetchFailedError, /Failed to fetch/)
    end

    it "raises when the configured selectors no longer match content on the page" do
      stub_request(:get, "https://example.com/posts/1").to_return(status: 200, body: "<html><body><p>redesigned page</p></body></html>")
      data = {url: "https://example.com/posts/1"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(/Could not extract updated content/)
    end
  end

  describe "#configure" do
    let(:configure_config) do
      {
        "base_url" => "https://example.com/posts"
      }
    end

    before do
      stub_request(:get, "https://example.com/posts")
        .to_return(status: 200, body: listing_html)
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_pagination).and_return(nil)
    end

    it "raises an error if the listing page cannot be fetched" do
      stub_request(:get, "https://example.com/posts")
        .to_return(status: 500)

      ingestor = described_class.new(configure_config)
      expect { ingestor.configure }.to raise_error(SourceIngestors::HttpClient::FetchFailedError, /Failed to fetch/)
    end

    it "returns all three selectors when they can all be detected" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".post-link")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: ".title", body: ".body", platform: "wordpress"})

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: "wordpress", selectors: {link: ".post-link", title: ".title", body: ".body"}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns type: nil when no article links are found on the listing page" do
      stub_request(:get, "https://example.com/posts")
        .to_return(status: 200, body: "<html><body><p>No links here</p></body></html>")

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns type: nil when the detected link selector matches no nodes" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".nonexistent")

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "resolves an article URL when the detected link selector targets a container element rather than the anchor" do
      container_listing = <<-HTML
        <html>
          <body>
            <article class="post-card"><a href="/posts/1">Post 1</a></article>
            <article class="post-card"><a href="/posts/2">Post 2</a></article>
          </body>
        </html>
      HTML

      stub_request(:get, "https://example.com/posts")
        .to_return(status: 200, body: container_listing)
      stub_request(:get, "https://example.com/posts/1")
        .to_return(status: 200, body: post_html)

      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return("article.post-card")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: ".title", body: ".body", platform: nil})

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {link: "article.post-card", title: ".title", body: ".body"}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns type: nil when the link selector cannot be determined" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(nil)

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns partial selectors when the title selector cannot be determined" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".post-link")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: nil, body: ".body", platform: nil})

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {link: ".post-link", title: nil, body: ".body"}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns partial selectors when the body selector cannot be determined" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".post-link")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: ".title", body: nil, platform: nil})

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: nil, selectors: {link: ".post-link", title: ".title", body: nil}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    it "returns platform and link even when both article selectors cannot be determined" do
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".post-link")
      allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: nil, body: nil, platform: "wordpress"})

      ingestor = described_class.new(configure_config)
      expect(ingestor.configure).to eq({type: "wordpress", selectors: {link: ".post-link", title: nil, body: nil}, pagination: {multi_page: false, suggested_website_url: nil}})
    end

    context "pagination" do
      before do
        allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(nil)
      end

      it "returns suggested_website_url and multi_page: true when base_url has a query-param pattern, without detecting from the page" do
        query_config = configure_config.merge("base_url" => "https://example.com/posts?page=2")
        stub_request(:get, "https://example.com/posts?page=1").to_return(status: 200, body: listing_html)
        expect_any_instance_of(SourceIngestors::SelectorDetector).not_to receive(:detect_pagination)

        ingestor = described_class.new(query_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: true, suggested_website_url: "https://example.com/posts?page={page}"}
        })
      end

      it "returns suggested_website_url and multi_page: true when base_url has a path-based pattern, without detecting from the page" do
        path_config = configure_config.merge("base_url" => "https://example.com/posts/page/1/")
        stub_request(:get, "https://example.com/posts/page/1/").to_return(status: 200, body: listing_html)
        expect_any_instance_of(SourceIngestors::SelectorDetector).not_to receive(:detect_pagination)

        ingestor = described_class.new(path_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: true, suggested_website_url: "https://example.com/posts/page/{page}/"}
        })
      end

      it "finds pagination directly from the listing page's own links, without needing the LLM" do
        paginated_listing_html = <<-HTML
          <html>
            <body>
              <a href="?page=2">Next</a>
            </body>
          </html>
        HTML
        stub_request(:get, "https://example.com/posts").to_return(status: 200, body: paginated_listing_html)
        expect_any_instance_of(SourceIngestors::SelectorDetector).not_to receive(:detect_pagination)

        ingestor = described_class.new(configure_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: true, suggested_website_url: "https://example.com/posts?page={page}"}
        })
      end

      it "uses the LLM's answer directly, since detect_pagination already resolves it to an absolute url" do
        allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_pagination).and_return("https://example.com/?query-0-page={page}")

        ingestor = described_class.new(configure_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: true, suggested_website_url: "https://example.com/?query-0-page={page}"}
        })
      end

      it "returns multi_page: false and no suggested_website_url when nothing is found anywhere" do
        ingestor = described_class.new(configure_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: false, suggested_website_url: nil}
        })
      end

      it "still returns real type/selectors when pagination detection raises unexpectedly" do
        allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_link).and_return(".post-link")
        allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_article).and_return({title: ".title", body: ".body", platform: "wordpress"})
        allow_any_instance_of(SourceIngestors::SelectorDetector).to receive(:detect_pagination).and_raise(StandardError, "boom")

        ingestor = described_class.new(configure_config)
        expect(ingestor.configure).to eq({
          type: "wordpress",
          selectors: {link: ".post-link", title: ".title", body: ".body"},
          pagination: {multi_page: nil, suggested_website_url: nil}
        })
      end

      it "skips pagination detection and echoes the template back when base_url already contains {page}" do
        templated_config = configure_config.merge("base_url" => "https://example.com/posts?page={page}")
        stub_request(:get, "https://example.com/posts?page=1").to_return(status: 200, body: listing_html)
        expect_any_instance_of(SourceIngestors::SelectorDetector).not_to receive(:detect_pagination)

        ingestor = described_class.new(templated_config)
        expect(ingestor.configure).to eq({
          type: nil,
          selectors: {},
          pagination: {multi_page: true, suggested_website_url: "https://example.com/posts?page={page}"}
        })
      end
    end
  end
end
