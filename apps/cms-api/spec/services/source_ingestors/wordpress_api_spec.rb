require "rails_helper"

require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

RSpec.describe SourceIngestors::WordpressApi, type: :service do
  let(:site_url) { "https://blog.example.com" }
  let(:posts_url) { "#{site_url}/wp-json/wp/v2/posts" }
  let(:config) { {"site_url" => site_url} }

  def wp_post(id, title: "Post #{id}", content: "<p>Body of post #{id}.</p>", protected: false)
    {
      "id" => id,
      "link" => "#{site_url}/post-#{id}/",
      "date" => "2024-01-0#{id}T12:00:00",
      "date_gmt" => "2024-01-0#{id}T10:00:00",
      "title" => {"rendered" => title},
      "content" => {"rendered" => content, "protected" => protected},
      "excerpt" => {"rendered" => "<p>Excerpt #{id}</p>\n", "protected" => protected}
    }
  end

  def stub_posts_page(page, posts, total: nil, total_pages: nil, per_page: described_class::PAGE_SIZE)
    headers = {"Content-Type" => "application/json"}
    headers["X-WP-Total"] = total.to_s if total
    headers["X-WP-TotalPages"] = total_pages.to_s if total_pages
    stub_request(:get, posts_url)
      .with(query: hash_including("page" => page.to_s, "per_page" => per_page.to_s))
      .to_return(status: 200, body: posts.to_json, headers: headers)
  end

  def stub_home_page(url = site_url, status: 200, body: "<html></html>", headers: {})
    stub_request(:get, url).to_return(status: status, body: body, headers: {"Content-Type" => "text/html"}.merge(headers))
  end

  before do
    allow(Resolv).to receive(:getaddresses).and_call_original
    allow(Resolv).to receive(:getaddresses).with("blog.example.com").and_return(["93.184.216.34"])
    allow(Resolv).to receive(:getaddresses).with("public-api.wordpress.com").and_return(["192.0.78.9"])
    stub_home_page(headers: {"Link" => "<#{site_url}/wp-json/>; rel=\"https://api.w.org/\""})
  end

  describe ".normalize_site_url" do
    it "keeps only the scheme, host and path" do
      expect(described_class.normalize_site_url(" HTTPS://Blog.Example.com/news/?utm_source=x#top ")).to eq("https://blog.example.com/news")
    end

    it "accepts a URL under the API root" do
      expect(described_class.normalize_site_url("https://blog.example.com/wp-json/wp/v2/posts")).to eq("https://blog.example.com")
    end

    it "accepts the default port" do
      expect(described_class.normalize_site_url("https://blog.example.com:443/")).to eq("https://blog.example.com")
    end

    it "rejects credentials, other ports, other schemes and URLs without a host" do
      expect(described_class.normalize_site_url("https://user:pass@blog.example.com")).to be_nil
      expect(described_class.normalize_site_url("https://blog.example.com:8443")).to be_nil
      expect(described_class.normalize_site_url("ftp://blog.example.com")).to be_nil
      expect(described_class.normalize_site_url("blog.example.com")).to be_nil
      expect(described_class.normalize_site_url("https://exa mple.com")).to be_nil
    end
  end

  describe ".detect_site_url" do
    def detect(url)
      described_class.detect_site_url(url, user_agent: "Suwali/test")
    end

    def stub_api_index(status: 404, body: "")
      stub_request(:get, "#{site_url}/wp-json/").with(query: {"_fields" => "home,namespaces"})
        .to_return(status: status, body: body.is_a?(String) ? body : body.to_json, headers: {"Content-Type" => "application/json"})
    end

    it "returns the site address when the page advertises a WordPress API" do
      expect(detect("#{site_url}/")).to eq(site_url)
      expect(WebMock).to have_requested(:get, site_url).with(headers: {"User-Agent" => "Suwali/test"}).once
    end

    it "falls back to the origin when the pasted page does not advertise the API" do
      stub_request(:get, "#{site_url}/feed").to_return(status: 200, body: "<rss version=\"2.0\"></rss>")

      expect(detect("#{site_url}/feed")).to eq(site_url)
    end

    it "keeps the path of a WordPress site installed in a subdirectory" do
      stub_request(:get, "#{site_url}/news/feed")
        .to_return(status: 200, body: "<rss version=\"2.0\"></rss>", headers: {"Link" => "<#{site_url}/news/wp-json/>; rel=\"https://api.w.org/\""})

      expect(detect("#{site_url}/news/feed")).to eq("#{site_url}/news")
    end

    it "understands ?rest_route= API roots" do
      stub_home_page(body: %(<html><head><link rel="https://api.w.org/" href="#{site_url}/index.php?rest_route=/"></head></html>))

      expect(detect(site_url)).to eq(site_url)
    end

    it "recognises *.wordpress.com sites without fetching them" do
      expect(detect("https://news.wordpress.com/feed/")).to eq("https://news.wordpress.com")
      expect(WebMock).not_to have_requested(:get, %r{news\.wordpress\.com})
    end

    it "returns nil when neither the page nor the origin advertises the API and there is no API index" do
      stub_home_page
      stub_request(:get, "#{site_url}/articles").to_return(status: 200, body: "<html></html>")
      stub_api_index

      expect(detect("#{site_url}/articles")).to be_nil
    end

    it "returns nil when the API root is advertised on another host" do
      stub_home_page(headers: {"Link" => "<https://cdn.example.com/wp-json/>; rel=\"https://api.w.org/\""})
      stub_api_index

      expect(detect(site_url)).to be_nil
    end

    it "returns nil when the site cannot be fetched" do
      stub_home_page(status: 500)
      stub_api_index(status: 500)

      expect(detect(site_url)).to be_nil
    end

    context "when the site hides the API link" do
      before { stub_home_page }

      it "recognises the site from its API index" do
        stub_request(:get, "#{site_url}/feed").to_return(status: 200, body: "<rss version=\"2.0\"></rss>")
        stub_api_index(status: 200, body: {"home" => "#{site_url}/", "namespaces" => ["oembed/1.0", "wp/v2"]})

        expect(detect("#{site_url}/feed/")).to eq(site_url)
      end

      it "returns the address the site calls home when it differs only by www." do
        stub_api_index(status: 200, body: {"home" => "https://www.blog.example.com", "namespaces" => ["wp/v2"]})

        expect(detect(site_url)).to eq("https://www.blog.example.com")
      end

      it "returns the origin when the index does not say where home is" do
        stub_api_index(status: 200, body: {"namespaces" => ["wp/v2"]})

        expect(detect(site_url)).to eq(site_url)
      end

      it "returns nil when home is on another host" do
        stub_api_index(status: 200, body: {"home" => "https://elsewhere.example.org", "namespaces" => ["wp/v2"]})

        expect(detect(site_url)).to be_nil
      end

      it "returns nil when the index does not serve the WordPress API" do
        stub_api_index(status: 200, body: {"home" => site_url, "namespaces" => ["some-plugin/v1"]})

        expect(detect(site_url)).to be_nil
      end

      it "returns nil when the index is not JSON" do
        stub_api_index(status: 200, body: "<html>Not found</html>")

        expect(detect(site_url)).to be_nil
      end
    end

    it "returns nil for an invalid URL without making a request" do
      expect(detect("not a url")).to be_nil
      expect(detect(nil)).to be_nil
      expect(WebMock).not_to have_requested(:get, site_url)
    end
  end

  describe "#call" do
    it "converts posts into documents" do
      stub_posts_page(1, [wp_post(2, title: "It&#8217;s <em>here</em>"), wp_post(1)], total: 2, total_pages: 1)

      documents, total, = described_class.new(config).call

      expect(total).to eq(2)
      expect(documents.size).to eq(2)
      expect(documents.first).to eq(
        external_id: "2",
        title: "It’s here",
        content: "Body of post 2.",
        date: Time.utc(2024, 1, 2, 10),
        link: "#{site_url}/post-2/",
        public_url: "#{site_url}/post-2/",
        metadata: {
          url: "#{site_url}/post-2/",
          published_at: Time.utc(2024, 1, 2, 10),
          description: "Excerpt 2"
        },
        document_type: "blog_post"
      )
    end

    it "requests the newest posts first with only the fields it needs" do
      stub_posts_page(1, [], total_pages: 0)

      described_class.new(config).call

      expect(WebMock).to have_requested(:get, posts_url).with(query: {
        "page" => "1",
        "per_page" => described_class::PAGE_SIZE.to_s,
        "orderby" => "date",
        "order" => "desc",
        "_fields" => described_class::POST_FIELDS
      })
    end

    it "follows pagination until the last page" do
      stub_posts_page(1, [wp_post(3)], total: 2, total_pages: 2)
      stub_posts_page(2, [wp_post(2)], total: 2, total_pages: 2)

      documents, = described_class.new(config).call

      expect(documents.map { |d| d[:external_id] }).to eq(["3", "2"])
      expect(WebMock).not_to have_requested(:get, posts_url).with(query: hash_including("page" => "3"))
    end

    # Later syncs stop at the first imported post, so anything the first sync leaves out is never reached
    it "reads every page of a site with more than 10 pages" do
      (1..11).each { |page| stub_posts_page(page, [wp_post(12 - page)], total: 11, total_pages: 11) }

      documents, = described_class.new(config).call

      expect(documents.map { |d| d[:external_id] }).to eq((1..11).map(&:to_s).reverse)
    end

    it "stops when a page past the end returns 400 and there are no pagination headers" do
      stub_posts_page(1, [wp_post(1)])
      stub_request(:get, posts_url)
        .with(query: hash_including("page" => "2"))
        .to_return(status: 400, body: {code: "rest_post_invalid_page_number"}.to_json)

      documents, total, = described_class.new(config).call

      expect(documents.size).to eq(1)
      expect(total).to eq(1)
    end

    it "stops at the first post that was already imported" do
      source = create(:source, :wordpress_api, config: config)
      create(:document, source: source, external_id: "2")
      stub_posts_page(1, [wp_post(3), wp_post(2), wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call(
        existing_documents_scope: Document.where(source_id: source.id),
        deleted_documents_scope: DeletedDocument.where(source_id: source.id)
      )

      expect(documents.map { |d| d[:external_id] }).to eq(["3"])
    end

    it "falls back to the site's local date when there is no GMT date" do
      stub_posts_page(1, [wp_post(1).merge("date_gmt" => nil)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.first[:date]).to eq(Time.zone.parse("2024-01-01T12:00:00"))
    end

    it "skips password-protected posts" do
      stub_posts_page(1, [wp_post(2, content: "", protected: true), wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.map { |d| d[:external_id] }).to eq(["1"])
    end

    it "strips scripts and styles from the post body" do
      body = "<style>p { color: red; }</style><p>Visible text</p><script>track()</script>"
      stub_posts_page(1, [wp_post(1, content: body)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.first[:content]).to eq("Visible text")
    end

    it "accepts a site URL that points at the API root" do
      stub_posts_page(1, [wp_post(1)], total_pages: 1)

      documents, = described_class.new({"site_url" => "#{site_url}/wp-json/"}).call

      expect(documents.size).to eq(1)
    end

    it "raises when the site does not expose the WordPress API" do
      stub_request(:get, posts_url).with(query: hash_including({})).to_return(status: 404, body: "<html>Not found</html>")

      expect { described_class.new(config).call }.to raise_error(/failed with status 404/)
    end

    it "raises when the response is not JSON" do
      stub_request(:get, posts_url).with(query: hash_including({})).to_return(status: 200, body: "<html>Hello</html>")

      expect { described_class.new(config).call }.to raise_error(/did not return a valid WordPress API response/)
    end

    it "returns nothing when no site URL is configured" do
      expect(described_class.new({}).call).to eq([[], nil, nil, nil, nil])
    end
  end

  describe "#preview" do
    before do
      stub_request(:get, "#{site_url}/wp-json/")
        .with(query: {"_fields" => "name"})
        .to_return(status: 200, body: {name: "Example &amp; Co"}.to_json, headers: {"Content-Type" => "application/json"})
    end

    it "returns a limited sample, the total, the site name and the normalized site URL" do
      posts = (1..described_class::PREVIEW_LIMIT).map { |id| wp_post(id) }
      stub_posts_page(1, posts, total: 37, total_pages: 8, per_page: described_class::PREVIEW_LIMIT)

      documents, total, suggested_name, errors, suggested_url = described_class.new({"site_url" => "#{site_url}/"}).preview

      expect(documents.size).to eq(described_class::PREVIEW_LIMIT)
      expect(total).to eq(37)
      expect(suggested_name).to eq("Example & Co")
      expect(errors).to be_nil
      expect(suggested_url).to eq(site_url)
      expect(WebMock).not_to have_requested(:get, posts_url).with(query: hash_including("page" => "2"))
    end

    it "falls back to the site URL when the site name is unavailable" do
      stub_request(:get, "#{site_url}/wp-json/").with(query: {"_fields" => "name"}).to_return(status: 500)
      stub_posts_page(1, [wp_post(1)], total: 1, total_pages: 1, per_page: described_class::PREVIEW_LIMIT)

      _, _, suggested_name, = described_class.new(config).preview

      expect(suggested_name).to eq(site_url)
    end

    it "falls back to the site URL when the site name response is not JSON" do
      stub_request(:get, "#{site_url}/wp-json/").with(query: {"_fields" => "name"}).to_return(status: 200, body: "<html></html>")
      stub_posts_page(1, [wp_post(1)], total: 1, total_pages: 1, per_page: described_class::PREVIEW_LIMIT)

      _, _, suggested_name, = described_class.new(config).preview

      expect(suggested_name).to eq(site_url)
    end
  end

  describe "API detection" do
    let(:wpcom_site_url) { "https://#{wpcom_host}/rest/v1.1/sites/blog.example.com" }
    let(:wpcom_host) { "public-api.wordpress.com" }

    def stub_wpcom_site(body, status: 200)
      stub_request(:get, wpcom_site_url)
        .with(query: {"fields" => "ID,jetpack"})
        .to_return(status: status, body: body.to_json, headers: {"Content-Type" => "application/json"})
    end

    it "uses the API root advertised in the Link header" do
      stub_home_page(headers: {"Link" => "<#{site_url}/blog/wp-json/>; rel=\"https://api.w.org/\", <#{site_url}/?p=1>; rel=shortlink"})
      stub_request(:get, "#{site_url}/blog/wp-json/wp/v2/posts").with(query: hash_including({}))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "uses the API root advertised in a <link> tag, including ?rest_route= roots" do
      stub_home_page(body: %(<html><head><link rel="https://api.w.org/" href="#{site_url}/?rest_route=/"></head></html>))
      stub_request(:get, site_url).with(query: hash_including("rest_route" => "/wp/v2/posts"))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "reads *.wordpress.com sites through the public API without probing the site" do
      wpcom_posts_url = "https://#{wpcom_host}/wp/v2/sites/news.wordpress.com/posts"
      stub_request(:get, wpcom_posts_url).with(query: hash_including({}))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})

      documents, = described_class.new({"site_url" => "https://news.wordpress.com"}).call

      expect(documents.size).to eq(1)
      expect(WebMock).not_to have_requested(:get, "https://news.wordpress.com")
    end

    it "does not mistake a domain that merely ends in wordpress.com for WordPress.com" do
      allow(Resolv).to receive(:getaddresses).with("notwordpress.com").and_return(["93.184.216.35"])
      stub_home_page("https://notwordpress.com", status: 404)
      stub_request(:get, "https://#{wpcom_host}/rest/v1.1/sites/notwordpress.com").with(query: hash_including({})).to_return(status: 404)
      stub_request(:get, "https://notwordpress.com/wp-json/wp/v2/posts").with(query: hash_including({}))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})

      documents, = described_class.new({"site_url" => "https://notwordpress.com"}).call

      expect(documents.size).to eq(1)
    end

    it "reads WordPress.com sites on a custom domain through the public API" do
      stub_home_page
      stub_wpcom_site({"ID" => 123, "jetpack" => false})
      stub_request(:get, "https://#{wpcom_host}/wp/v2/sites/blog.example.com/posts").with(query: hash_including({}))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "reads Jetpack-connected self-hosted sites directly" do
      stub_home_page
      stub_wpcom_site({"ID" => 123, "jetpack" => true})
      stub_posts_page(1, [wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "ignores an API root advertised on another host" do
      stub_home_page(headers: {"Link" => "<https://api.elsewhere.com/wp-json/>; rel=\"https://api.w.org/\""})
      stub_wpcom_site({"error" => "unknown_blog"}, status: 404)
      stub_posts_page(1, [wp_post(1)], total_pages: 1)
      ingestor = described_class.new(config)

      documents, = ingestor.call

      expect(documents.size).to eq(1)
      expect(WebMock).not_to have_requested(:get, /api\.elsewhere\.com/)
    end

    it "ignores a <link> tag outside <head>, where page content could have put it" do
      stub_home_page(body: %(<html><head></head><body><link rel="https://api.w.org/" href="#{site_url}/injected/wp-json/"></body></html>))
      stub_wpcom_site({"error" => "unknown_blog"}, status: 404)
      stub_posts_page(1, [wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
      expect(WebMock).not_to have_requested(:get, %r{/injected/})
    end

    it "falls back to /wp-json when nothing advertises an API root" do
      stub_home_page(status: 500)
      stub_wpcom_site({"error" => "unknown_blog"}, status: 404)
      stub_posts_page(1, [wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "falls back to /wp-json when the home page and WordPress.com both fail" do
      stub_request(:get, site_url).to_timeout
      stub_request(:get, wpcom_site_url).with(query: {"fields" => "ID,jetpack"}).to_return(status: 200, body: "<html></html>")
      stub_posts_page(1, [wp_post(1)], total_pages: 1)

      documents, = described_class.new(config).call

      expect(documents.size).to eq(1)
    end

    it "uses a stored API base without probing the site" do
      stub_request(:get, "https://cdn.example.com/wp-json/wp/v2/posts").with(query: hash_including({}))
        .to_return(status: 200, body: [wp_post(1)].to_json, headers: {"X-WP-TotalPages" => "1"})
      allow(Resolv).to receive(:getaddresses).with("cdn.example.com").and_return(["93.184.216.36"])
      ingestor = described_class.new(config.merge("api_base" => "https://cdn.example.com/wp-json/wp/v2"))

      documents, = ingestor.call

      expect(documents.size).to eq(1)
      expect(WebMock).not_to have_requested(:get, site_url)
    end

    it "fails without looking for another API when the stored one stops working" do
      stale_base = "#{site_url}/old/wp-json/wp/v2"
      stub_request(:get, "#{stale_base}/posts").with(query: hash_including({})).to_return(status: 404, body: "{}")

      expect { described_class.new(config.merge("api_base" => stale_base)).call }.to raise_error(/failed with status 404/)
      expect(WebMock).not_to have_requested(:get, site_url)
    end

    it "reads the site name of a WordPress.com site from the public API" do
      stub_request(:get, "https://#{wpcom_host}/wp/v2/sites/news.wordpress.com/posts").with(query: hash_including({}))
        .to_return(status: 200, body: [].to_json, headers: {"X-WP-TotalPages" => "0"})
      stub_request(:get, "https://#{wpcom_host}/rest/v1.1/sites/news.wordpress.com").with(query: {"fields" => "name"})
        .to_return(status: 200, body: {name: "The News"}.to_json, headers: {"Content-Type" => "application/json"})

      _, _, suggested_name, = described_class.new({"site_url" => "https://news.wordpress.com"}).preview

      expect(suggested_name).to eq("The News")
    end
  end

  describe "#tagline_includes?" do
    let(:code) { "suwali-7f3a9c2e41d0" }

    def stub_tagline(url, description, fields_param: "_fields")
      stub_request(:get, url)
        .with(query: hash_including(fields_param => "description"))
        .to_return(status: 200, body: {description: description}.to_json, headers: {"Content-Type" => "application/json"})
    end

    it "finds the code in a self-hosted site's tagline, read from its API root" do
      stub_tagline("#{site_url}/wp-json/", "News &amp; views · SUWALI-7F3A9C2E41D0")

      expect(described_class.new(config).tagline_includes?(code)).to be(true)
    end

    it "does not find the code when the tagline lacks it" do
      stub_tagline("#{site_url}/wp-json/", "Just another WordPress site")

      expect(described_class.new(config).tagline_includes?(code)).to be(false)
    end

    it "reads the tagline from the API root the site advertises, not the home page" do
      stub_home_page(headers: {"Link" => "<#{site_url}/blog/wp-json/>; rel=\"https://api.w.org/\""})
      stub_tagline("#{site_url}/blog/wp-json/", "Blog #{code}")

      expect(described_class.new(config).tagline_includes?(code)).to be(true)
    end

    it "reads a WordPress.com site's tagline from the public API" do
      stub_tagline("https://public-api.wordpress.com/rest/v1.1/sites/news.wordpress.com", "Daily #{code}", fields_param: "fields")

      expect(described_class.new({"site_url" => "https://news.wordpress.com"}).tagline_includes?(code)).to be(true)
    end

    it "asks for a fresh copy so caches cannot hide a new tagline" do
      stub_tagline("#{site_url}/wp-json/", code)

      described_class.new(config).tagline_includes?(code)

      expect(WebMock).to have_requested(:get, "#{site_url}/wp-json/").with(query: hash_including("_" => /\A[0-9a-f]{8}\z/))
    end

    it "raises when the tagline cannot be read" do
      stub_request(:get, "#{site_url}/wp-json/").with(query: hash_including({})).to_return(status: 500)

      expect { described_class.new(config).tagline_includes?(code) }.to raise_error(described_class::SiteCheckFailedError, /Could not read the tagline/)
    end
  end

  describe "#application_passwords_authorization_url" do
    let(:authorization_url) { "#{site_url}/wp-admin/authorize-application.php" }

    def stub_index(authentication)
      stub_request(:get, "#{site_url}/wp-json/")
        .with(query: hash_including("_fields" => "authentication"))
        .to_return(status: 200, body: {authentication: authentication}.to_json, headers: {"Content-Type" => "application/json"})
    end

    it "returns the approval page the site advertises in its API index" do
      stub_index({"application-passwords" => {"endpoints" => {"authorization" => authorization_url}}})

      expect(described_class.new(config).application_passwords_authorization_url).to eq(authorization_url)
    end

    it "is nil when the site does not advertise Application Passwords" do
      stub_index([])

      expect(described_class.new(config).application_passwords_authorization_url).to be_nil
    end

    it "is nil when the approval page is on another host" do
      stub_index({"application-passwords" => {"endpoints" => {"authorization" => "https://evil.example.com/authorize"}}})

      expect(described_class.new(config).application_passwords_authorization_url).to be_nil
    end

    it "is nil when the site's API is not served over HTTPS" do
      stub_home_page("http://blog.example.com", headers: {"Link" => "<http://blog.example.com/wp-json/>; rel=\"https://api.w.org/\""})

      expect(described_class.new({"site_url" => "http://blog.example.com"}).application_passwords_authorization_url).to be_nil
    end

    it "is nil when the approval page is not a valid URL" do
      stub_index({"application-passwords" => {"endpoints" => {"authorization" => "https://exa mple.com/authorize"}}})

      expect(described_class.new(config).application_passwords_authorization_url).to be_nil
    end

    it "is nil for WordPress.com sites, without asking them" do
      expect(described_class.new({"site_url" => "https://news.wordpress.com"}).application_passwords_authorization_url).to be_nil
      expect(WebMock).not_to have_requested(:get, /public-api\.wordpress\.com/)
    end

    it "is nil when the index cannot be read" do
      stub_request(:get, "#{site_url}/wp-json/").with(query: hash_including({})).to_return(status: 500)

      expect(described_class.new(config).application_passwords_authorization_url).to be_nil
    end
  end

  describe "#check_administrator" do
    let(:me_url) { "#{site_url}/wp-json/wp/v2/users/me" }
    let(:uuid) { "6f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b" }
    let(:credentials) { ["admin", "abcd EFGH 1234 ijkl MNOP 6789"] }

    def stub_me(status: 200, capabilities: {"manage_options" => true})
      stub_request(:get, me_url)
        .with(query: hash_including("context" => "edit"), basic_auth: credentials)
        .to_return(status: status, body: {capabilities: capabilities}.to_json, headers: {"Content-Type" => "application/json"})
    end

    def stub_revocation(introspect_status: 200, delete_status: 200)
      stub_request(:get, "#{me_url}/application-passwords/introspect")
        .with(query: hash_including({}), basic_auth: credentials)
        .to_return(status: introspect_status, body: {uuid: uuid}.to_json, headers: {"Content-Type" => "application/json"})
      stub_request(:delete, "#{me_url}/application-passwords/#{uuid}")
        .with(basic_auth: credentials)
        .to_return(status: delete_status, body: {deleted: true}.to_json)
    end

    it "verifies an administrator and revokes the password" do
      stub_me
      stub_revocation

      check = described_class.new(config).check_administrator(*credentials)

      expect(check.status).to eq(:verified)
      expect(check.password_revoked).to be(true)
      expect(WebMock).to have_requested(:delete, "#{me_url}/application-passwords/#{uuid}")
    end

    it "does not verify a user who cannot manage the site, and still revokes the password" do
      stub_me(capabilities: {"edit_posts" => true})
      stub_revocation

      check = described_class.new(config).check_administrator(*credentials)

      expect(check.status).to eq(:not_admin)
      expect(check.password_revoked).to be(true)
    end

    it "revokes the password even when the check fails" do
      stub_me(status: 500)
      stub_revocation

      expect { described_class.new(config).check_administrator(*credentials) }.to raise_error(described_class::SiteCheckFailedError, /Could not check your account/)
      expect(WebMock).to have_requested(:delete, "#{me_url}/application-passwords/#{uuid}")
    end

    it "reports credentials the site refuses" do
      stub_me(status: 401)

      expect(described_class.new(config).check_administrator(*credentials).status).to eq(:rejected)
    end

    it "still verifies when the password cannot be revoked" do
      stub_me
      stub_revocation(introspect_status: 404)

      check = described_class.new(config).check_administrator(*credentials)

      expect(check.status).to eq(:verified)
      expect(check.password_revoked).to be(false)
      expect(WebMock).not_to have_requested(:delete, /application-passwords/)
    end

    it "still verifies when the site's answer about the password is not JSON" do
      stub_me
      stub_request(:get, "#{me_url}/application-passwords/introspect")
        .with(query: hash_including({}), basic_auth: credentials)
        .to_return(status: 200, body: "<html></html>")

      check = described_class.new(config).check_administrator(*credentials)

      expect(check.status).to eq(:verified)
      expect(check.password_revoked).to be(false)
    end

    it "never sends the credentials to an API on another host" do
      allow(Resolv).to receive(:getaddresses).with("api.elsewhere.com").and_return(["93.184.216.35"])
      ingestor = described_class.new(config.merge("api_base" => "https://api.elsewhere.com/wp-json/wp/v2"))

      expect { ingestor.check_administrator(*credentials) }.to raise_error(described_class::SiteCheckFailedError, /cannot be verified/)
      expect(WebMock).not_to have_requested(:get, /api\.elsewhere\.com/)
    end

    it "raises without the credentials in the message when the site fails" do
      stub_me(status: 500)
      stub_revocation

      expect { described_class.new(config).check_administrator(*credentials) }.to raise_error do |error|
        expect(error.message).to include("status 500")
        expect(error.message).not_to include(credentials.last)
      end
    end
  end

  describe "#as_file" do
    it "writes the title, date and content to a text file" do
      path = described_class.new(config).as_file(title: "Title", date: "2024-01-01", content: "Body")

      expect(File.read(path)).to eq("Title\n\nDate: 2024-01-01\n\nBody")
    ensure
      File.delete(path) if path && File.exist?(path)
    end
  end

  describe "#refetch_document_data" do
    it "is supported" do
      expect(described_class.new(config).refresh_supported?).to be(true)
    end

    it "fetches the post by its ID" do
      stub_request(:get, "#{posts_url}/7")
        .with(query: {"_fields" => described_class::POST_FIELDS})
        .to_return(status: 200, body: wp_post(7, title: "Updated").to_json, headers: {"Content-Type" => "application/json"})

      doc_data = described_class.new(config).refetch_document_data(external_id: "7")

      expect(doc_data[:title]).to eq("Updated")
      expect(doc_data[:content]).to eq("Body of post 7.")
      expect(doc_data[:metadata][:url]).to eq("#{site_url}/post-7/")
    end

    it "raises when the post no longer exists" do
      stub_request(:get, "#{posts_url}/7").with(query: hash_including({})).to_return(status: 404, body: "{}")

      expect { described_class.new(config).refetch_document_data(external_id: "7") }
        .to raise_error(/Could not fetch WordPress post 7/)
    end
  end
end
