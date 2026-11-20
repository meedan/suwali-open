require "rails_helper"

RSpec.describe SourceIngestors::SelectorDetector do
  let(:detector) { described_class.new }

  let(:article_html) do
    <<~HTML
      <html>
        <body>
          <nav id="site-nav"><a href="/">Home</a></nav>
          <main>
            <article class="post-content">
              <h1 class="article-title">Article Title</h1>
              <p>Article body text with enough content to be meaningful.</p>
            </article>
          </main>
          <footer id="site-footer">Footer</footer>
        </body>
      </html>
    HTML
  end

  let(:listing_html) do
    <<~HTML
      <html>
        <body>
          <nav id="site-nav"><a href="/">Home</a></nav>
          <main>
            <section class="article-list">
              <article class="article-item">
                <a class="article-link" href="/article-1">Article One Title</a>
              </article>
              <article class="article-item">
                <a class="article-link" href="/article-2">Article Two Title</a>
              </article>
            </section>
          </main>
          <footer id="site-footer">Footer</footer>
        </body>
      </html>
    HTML
  end

  describe "#detect_body" do
    it "returns nil when html is blank" do
      expect(detector.detect_body("")).to be_nil
      expect(detector.detect_body(nil)).to be_nil
    end

    it "returns nil when the skeleton is blank" do
      expect(detector.detect_body(" ")).to be_nil
    end

    it "returns nil when the page has no identifiable elements" do
      expect(detector.detect_body("<p>just text</p>")).to be_nil
    end

    it "returns the selector suggested by the LLM" do
      stub_llm_response("article.post-content")

      expect(detector.detect_body(article_html)).to eq("article.post-content")
    end

    it "sends skeleton HTML without text content to the LLM" do
      expect_llm_prompt do |prompt|
        expect(prompt).not_to include("Article Title")
        expect(prompt).not_to include("Article body text")
        expect(prompt).to include("post-content")
      end

      detector.detect_body(article_html)
    end

    it "strips navigation and footer from the skeleton sent to the LLM" do
      expect_llm_prompt do |prompt|
        expect(prompt).not_to include("site-nav")
        expect(prompt).not_to include("site-footer")
      end

      detector.detect_body(article_html)
    end

    it "returns nil when the skeleton exceeds the model's context length" do
      stub_llm_error(RubyLLM::ContextLengthExceededError)

      expect(detector.detect_body(article_html)).to be_nil
    end

    it "returns nil when the LLM call fails" do
      stub_llm_error(RubyLLM::Error)

      expect(detector.detect_body(article_html)).to be_nil
    end

    it "returns nil when the LLM returns an invalid CSS selector" do
      stub_llm_response("not a {valid} selector")

      expect(detector.detect_body(article_html)).to be_nil
    end

    it "logs with the 'body' label on success" do
      stub_llm_response("article.post-content")
      expect(LogService).to receive(:log).with(:info, "SelectorDetector", /\Abody —/)
      detector.detect_body(article_html)
    end

    it "logs with the 'body' label on LLM error" do
      stub_llm_error(RubyLLM::Error)
      expect(LogService).to receive(:log).with(:error, "SelectorDetector", /\Abody —/)
      detector.detect_body(article_html)
    end
  end

  describe "#detect_link" do
    it "returns nil when html is blank" do
      expect(detector.detect_link("")).to be_nil
      expect(detector.detect_link(nil)).to be_nil
    end

    it "returns nil when the skeleton is blank" do
      expect(detector.detect_link(" ")).to be_nil
    end

    it "returns nil when the page has no identifiable elements" do
      expect(detector.detect_link("<p>just text</p>")).to be_nil
    end

    it "returns the selector suggested by the LLM" do
      stub_llm_response("a.article-link")

      expect(detector.detect_link(listing_html)).to eq("a.article-link")
    end

    it "sends skeleton HTML without text content to the LLM" do
      expect_llm_prompt do |prompt|
        expect(prompt).not_to include("Article One Title")
        expect(prompt).not_to include("Article Two Title")
        expect(prompt).to include("article-link")
      end

      detector.detect_link(listing_html)
    end

    it "strips navigation and footer from the skeleton sent to the LLM" do
      expect_llm_prompt do |prompt|
        expect(prompt).not_to include("site-nav")
        expect(prompt).not_to include("site-footer")
      end

      detector.detect_link(listing_html)
    end

    it "returns nil when the skeleton exceeds the model's context length" do
      stub_llm_error(RubyLLM::ContextLengthExceededError)

      expect(detector.detect_link(listing_html)).to be_nil
    end

    it "returns nil when the LLM call fails" do
      stub_llm_error(RubyLLM::Error)

      expect(detector.detect_link(listing_html)).to be_nil
    end

    it "returns nil when the LLM returns an invalid CSS selector" do
      stub_llm_response("not a {valid} selector")

      expect(detector.detect_link(listing_html)).to be_nil
    end

    it "logs with the 'link' label on success" do
      stub_llm_response("a.article-link")
      expect(LogService).to receive(:log).with(:info, "SelectorDetector", /\Alink —/)
      detector.detect_link(listing_html)
    end

    it "logs with the 'link' label on LLM error" do
      stub_llm_error(RubyLLM::Error)
      expect(LogService).to receive(:log).with(:error, "SelectorDetector", /\Alink —/)
      detector.detect_link(listing_html)
    end
  end

  describe "#detect_article" do
    it "returns nil title and body when html is blank" do
      expect(detector.detect_article("")).to include(title: nil, body: nil, platform: nil)
      expect(detector.detect_article(nil)).to include(title: nil, body: nil, platform: nil)
    end

    it "returns nil title and body when the skeleton is blank" do
      expect(detector.detect_article(" ")).to include(title: nil, body: nil, platform: nil)
    end

    it "returns nil title and body when the page has no identifiable elements" do
      expect(detector.detect_article("<p>just text</p>")).to include(title: nil, body: nil, platform: nil)
    end

    it "returns title, body, and platform selectors when detected" do
      stub_llm_article_response(title: "h1.article-title", body: "article.post-content", platform: "wordpress")

      expect(detector.detect_article(article_html)).to include(title: "h1.article-title", body: "article.post-content", platform: "wordpress")
    end

    it "returns the platform detected by the LLM" do
      stub_llm_article_response(title: "h1", body: "article", platform: "substack")

      expect(detector.detect_article(article_html)[:platform]).to eq("substack")
    end

    it "returns nil when the LLM returns no platform" do
      stub_llm_article_response(title: "h1", body: "article", platform: nil)

      expect(detector.detect_article(article_html)[:platform]).to be_nil
    end

    it "sends skeleton HTML without text content to the LLM" do
      expect_llm_article_prompt do |prompt|
        expect(prompt).not_to include("Article Title")
        expect(prompt).not_to include("Article body text")
        expect(prompt).to include("article-title")
        expect(prompt).to include("post-content")
      end

      detector.detect_article(article_html)
    end

    it "strips navigation and footer from the skeleton sent to the LLM" do
      expect_llm_article_prompt do |prompt|
        expect(prompt).not_to include("site-nav")
        expect(prompt).not_to include("site-footer")
      end

      detector.detect_article(article_html)
    end

    it "returns nil title and body when the skeleton exceeds the model's context length" do
      stub_llm_article_error(RubyLLM::ContextLengthExceededError)

      expect(detector.detect_article(article_html)).to include(title: nil, body: nil, platform: nil)
    end

    it "returns nil title and body when the LLM call fails" do
      stub_llm_article_error(RubyLLM::Error)

      expect(detector.detect_article(article_html)).to include(title: nil, body: nil, platform: nil)
    end

    it "returns nil title when the LLM returns an invalid title selector" do
      stub_llm_article_response(title: "not a {valid} selector", body: "article.post-content")

      expect(detector.detect_article(article_html)).to include(title: nil, body: "article.post-content", platform: nil)
    end

    it "returns nil body when the LLM returns an invalid body selector" do
      stub_llm_article_response(title: "h1.article-title", body: "not a {valid} selector")

      expect(detector.detect_article(article_html)).to include(title: "h1.article-title", body: nil, platform: nil)
    end

    it "logs with the 'article_selectors' label on success" do
      stub_llm_article_response(title: "h1.article-title", body: "article.post-content")
      expect(LogService).to receive(:log).with(:info, "SelectorDetector", /\Aarticle_selectors —/)
      detector.detect_article(article_html)
    end

    it "logs with the 'article_selectors' label on LLM error" do
      stub_llm_article_error(RubyLLM::Error)
      expect(LogService).to receive(:log).with(:error, "SelectorDetector", /\Aarticle_selectors —/)
      detector.detect_article(article_html)
    end
  end

  describe "#detect_pagination" do
    let(:base_url) { "https://example.com" }

    let(:numbered_path_pagination_html) do
      <<~HTML
        <html>
          <body>
            <nav id="site-nav"><a href="/">Home</a></nav>
            <main>
              <section class="article-list">
                <article class="article-item"><a href="/blog/article-1">Article One</a></article>
                <article class="article-item"><a href="/blog/article-2">Article Two</a></article>
              </section>
              <a class="pager-next" href="/archive/2">Next</a>
              <a class="pager-alt" href="/?query-0-page=2">2</a>
            </main>
            <footer id="site-footer">Footer</footer>
          </body>
        </html>
      HTML
    end

    let(:no_pagination_html) do
      <<~HTML
        <html>
          <body>
            <nav id="site-nav"><a href="/">Home</a></nav>
            <main>
              <section class="article-list">
                <article class="article-item"><a href="/blog/article-1">Article One</a></article>
                <article class="article-item"><a href="/blog/article-2">Article Two</a></article>
              </section>
            </main>
            <footer id="site-footer">Footer</footer>
          </body>
        </html>
      HTML
    end

    it "returns nil when html is blank" do
      expect(detector.detect_pagination("", base_url)).to be_nil
      expect(detector.detect_pagination(nil, base_url)).to be_nil
    end

    it "returns nil without calling the LLM when the page has no hrefs at all" do
      html = "<html><body><article>Just article text, no links at all.</article></body></html>"
      expect(RubyLLM).not_to receive(:chat)

      expect(detector.detect_pagination(html, base_url)).to be_nil
    end

    it "asks the LLM and returns its validated template, already absolute since it's fed absolute hrefs" do
      ["https://example.com/archive/{page}", "https://example.com/?query-0-page={page}"].each do |template|
        stub_llm_pagination_response(template)

        expect(detector.detect_pagination(numbered_path_pagination_html, base_url)).to eq(template)
      end
    end

    it "returns nil when the LLM template doesn't match any real href on the page" do
      stub_llm_pagination_response("https://example.com/some/hallucinated/{page}")

      expect(detector.detect_pagination(numbered_path_pagination_html, base_url)).to be_nil
    end

    it "still finds the pagination link when the page has far more than 50 other links" do
      filler_links = (1..60).map { |i| %(<a href="/filler-#{i}">Filler #{i}</a>) }.join
      html = "<html><body>#{filler_links}<a href=\"/archive/2\">Next</a></body></html>"
      stub_llm_pagination_response("https://example.com/archive/{page}")

      expect(detector.detect_pagination(html, base_url)).to eq("https://example.com/archive/{page}")
    end

    it "returns nil when the LLM call fails" do
      stub_llm_pagination_error(RubyLLM::Error)

      expect(detector.detect_pagination(numbered_path_pagination_html, base_url)).to be_nil
    end

    it "returns nil when the input exceeds the model's context length" do
      stub_llm_pagination_error(RubyLLM::ContextLengthExceededError)

      expect(detector.detect_pagination(numbered_path_pagination_html, base_url)).to be_nil
    end

    it "returns nil when the LLM finds no pagination link" do
      stub_llm_pagination_response(nil)

      expect(detector.detect_pagination(no_pagination_html, base_url)).to be_nil
    end

    it "returns nil when the LLM correctly declines an opaque or offset-based scheme" do
      html = <<~HTML
        <html>
          <body>
            <nav id="site-nav"><a href="/">Home</a></nav>
            <main>
              <section class="article-list">
                <article class="article-item"><a href="/blog/article-1">Article One</a></article>
                <article class="article-item"><a href="/blog/article-2">Article Two</a></article>
              </section>
              <a class="pager-next" href="?cursor=eyJwYWdlIjoxfQ==">Next</a>
            </main>
            <footer id="site-footer">Footer</footer>
          </body>
        </html>
      HTML
      stub_llm_pagination_response(nil)

      expect(detector.detect_pagination(html, base_url)).to be_nil
    end

    it "accepts a mistemplated offset-style href — known gap, can't distinguish an offset from a real page number" do
      html = <<~HTML
        <html>
          <body>
            <nav id="site-nav"><a href="/">Home</a></nav>
            <main>
              <section class="article-list">
                <article class="article-item"><a href="/blog/article-1">Article One</a></article>
                <article class="article-item"><a href="/blog/article-2">Article Two</a></article>
              </section>
              <a class="pager-next" href="?offset=24">Next</a>
            </main>
            <footer id="site-footer">Footer</footer>
          </body>
        </html>
      HTML
      stub_llm_pagination_response("https://example.com?offset={page}")

      expect(detector.detect_pagination(html, base_url)).to eq("https://example.com?offset={page}")
    end

    it "logs with the 'pagination' label on success" do
      stub_llm_pagination_response("/archive/{page}")
      expect(LogService).to receive(:log).with(:info, "SelectorDetector", /\Apagination —/)

      detector.detect_pagination(numbered_path_pagination_html, base_url)
    end

    it "logs with the 'pagination' label on LLM error" do
      stub_llm_pagination_error(RubyLLM::Error)
      expect(LogService).to receive(:log).with(:error, "SelectorDetector", /\Apagination —/)

      detector.detect_pagination(numbered_path_pagination_html, base_url)
    end
  end

  private

  def llm_pagination_message(pagination_template)
    tokens = double(input: 10, output: 5)
    instance_double(RubyLLM::Message, content: {"pagination_template" => pagination_template}, model_id: "gpt-test", tokens: tokens)
  end

  def stub_llm_pagination_response(pagination_template)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_return(llm_pagination_message(pagination_template))
  end

  def stub_llm_pagination_error(error_class)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_raise(error_class)
  end

  def llm_article_message(title:, body:, platform: nil)
    tokens = double(input: 10, output: 5)
    instance_double(RubyLLM::Message, content: {"title_selector" => title, "body_selector" => body, "platform" => platform}, model_id: "gpt-test", tokens: tokens)
  end

  def stub_llm_article_response(title:, body:, platform: nil)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_return(llm_article_message(title: title, body: body, platform: platform))
  end

  def stub_llm_article_error(error_class)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_raise(error_class)
  end

  def expect_llm_article_prompt(&block)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask) do |prompt|
      block.call(prompt)
      llm_article_message(title: "h1", body: ".post-content")
    end
  end

  def llm_message(selector)
    tokens = double(input: 10, output: 5)
    instance_double(RubyLLM::Message, content: {"selector" => selector}, model_id: "gpt-test", tokens: tokens)
  end

  def stub_llm_response(selector)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_return(llm_message(selector))
  end

  def stub_llm_error(error_class)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask).and_raise(error_class)
  end

  def expect_llm_prompt(&block)
    schema_chat = instance_double(RubyLLM::Chat)
    allow(RubyLLM).to receive(:chat).and_return(instance_double(RubyLLM::Chat, with_schema: schema_chat))
    allow(schema_chat).to receive(:ask) do |prompt|
      block.call(prompt)
      llm_message(".post-content")
    end
  end
end
