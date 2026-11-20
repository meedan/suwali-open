require "ruby_llm"
require "ruby_llm/schema"
require_relative "html_helper"

module SourceIngestors
  class SelectorDetector
    include HtmlHelper

    class SelectorSchema < RubyLLM::Schema
      string :selector, description: "CSS selector matching the target element"
    end

    class ArticleSchema < RubyLLM::Schema
      string :title_selector, description: "CSS selector for the main article headline"
      string :body_selector, description: "CSS selector for the main article body container"
      string :platform, description: "Publishing platform (e.g. 'wordpress', 'substack', 'medium', 'ghost', 'drupal') — omit or leave blank if it cannot be identified"
    end

    class PaginationSchema < RubyLLM::Schema
      string :pagination_template, description: "One of the provided hrefs, with its page number replaced by the literal string {page} — omit or leave blank if none match"
    end

    LINK_PROMPT = ->(html) {
      "You are an expert web scraper. Below is an HTML skeleton (text removed, only class/id structure remains) from a listings page. " \
      "Return the CSS selector that targets the primary <a> link for each entry in the list — the link that navigates to the full article page. " \
      "Listing pages show a repeating set of article entries; each entry has one main link to the full article. " \
      "The href should point to an individual article page (e.g. /article/slug, /2024/01/title) — not a category, tag, author profile, or pagination URL. " \
      "The selector must generalize to each entry in the list, not target one specific item. " \
      "Prefer the shortest selector that reliably identifies the pattern (e.g. '.article-link' over 'main .list .item > a.article-link'). " \
      "Avoid IDs containing numbers (e.g. #post-123) — those are unique per item and won't generalize.\n\nHTML skeleton:\n#{html}"
    }

    BODY_PROMPT = ->(html) {
      "You are an expert web scraper. Below is an HTML skeleton (text removed, only class/id structure remains) from an article page. " \
      "Return the CSS selector that targets the main article body container — not the headline, byline, sidebar, or comments. " \
      "Prefer the shortest selector that reliably identifies the content area (e.g. 'article' or '.post-content' over 'main .wrapper article.post > .content'). " \
      "Avoid IDs containing numbers (e.g. #post-123) — those are unique per article and won't work on other pages.\n\nHTML skeleton:\n#{html}"
    }

    ARTICLE_PROMPT = ->(html) {
      "You are an expert web scraper. Below is an HTML skeleton (text removed, only class/id structure remains) from an article page. " \
      "Return THREE things: a selector for the main article headline, a selector for the main article body container, and the publishing platform. " \
      "For the selectors: prefer the shortest selectors that reliably identify each element (e.g. 'h1' or 'h1.post-title' for the headline; 'article' or '.post-content' for the body). " \
      "Do not target the byline, sidebar, or comments. " \
      "Avoid IDs containing numbers (e.g. #post-123) — those are unique per article and won't generalize. " \
      "If class names appear minified or obfuscated (single-letter or short random strings like 'am', 'du', 'gk'), prefer the bare tag name or a structural selector instead (e.g. 'h1' over 'h1.am.bx.cy', 'article' over 'div.q.du.if'). " \
      "For the platform: identify the publishing platform (e.g. wordpress, substack, medium, ghost, drupal) using class names, IDs, and structural patterns as signals. " \
      "Leave it blank if the platform cannot be identified.\n\nHTML skeleton:\n#{html}"
    }

    PAGINATION_PROMPT = ->(hrefs) {
      "You are an expert web scraper. Below is a list of hrefs found on a listings page. " \
      "Find the one that links to the NEXT page of the SAME listing (e.g. \"page 2\", \"next\") — " \
      "not a link to an individual article, category, tag, author page, or an unrelated part of the site. " \
      "Return it as a template: keep the href exactly as written, but replace the part that represents the page number with the literal string \"{page}\" — " \
      "e.g. \"/archive/2\" becomes \"/archive/{page}\", \"?page=2\" becomes \"?page={page}\", \"/?query-0-page=2\" becomes \"/?query-0-page={page}\". " \
      "Leave it blank if none of them are pagination links, or if there's no page number to replace.\n\nHrefs:\n#{hrefs.join("\n")}"
    }

    def detect_link(html) = detect(html, LINK_PROMPT, "link")

    def detect_body(html) = detect(html, BODY_PROMPT, "body")

    def detect_article(html)
      return {title: nil, body: nil, platform: nil} if html.blank?
      skeleton = build_skeleton(html)
      return {title: nil, body: nil, platform: nil} if skeleton.blank?

      result, elapsed_ms = timed { RubyLLM.chat.with_schema(ArticleSchema).ask(ARTICLE_PROMPT.call(skeleton)) }
      title = result.content&.dig("title_selector")
      body = result.content&.dig("body_selector")
      platform = result.content&.dig("platform").presence
      LogService.log(:info, "SelectorDetector",
        "article_selectors — title=#{title} body=#{body} platform=#{platform} model=#{result.model_id} input_tokens=#{result.tokens.input} output_tokens=#{result.tokens.output} elapsed_ms=#{elapsed_ms}")

      {
        title: valid_selector?(title) ? title : nil,
        body: valid_selector?(body) ? body : nil,
        platform: platform
      }
    rescue RubyLLM::ContextLengthExceededError
      LogService.log(:error, "SelectorDetector", "article_selectors — skeleton exceeded context length")
      {title: nil, body: nil, platform: nil}
    rescue RubyLLM::Error => e
      LogService.log(:error, "SelectorDetector", "article_selectors — LLM request failed: #{e.message}")
      {title: nil, body: nil, platform: nil}
    end

    def detect_pagination(html, base_url)
      return nil if html.blank?

      links = strip_header_footer(html).css("a[href]").map { |a| resolve_url(base_url, a["href"]) }.uniq.last(50)
      return nil if links.empty?

      result, elapsed_ms = timed { RubyLLM.chat.with_schema(PaginationSchema).ask(PAGINATION_PROMPT.call(links)) }
      template = result.content&.dig("pagination_template").presence
      LogService.log(:info, "SelectorDetector",
        "pagination — template=#{template} model=#{result.model_id} input_tokens=#{result.tokens.input} output_tokens=#{result.tokens.output} elapsed_ms=#{elapsed_ms}")

      template_matches_real_href?(template, links) ? template : nil
    rescue RubyLLM::ContextLengthExceededError
      LogService.log(:error, "SelectorDetector", "pagination — input exceeded context length")
      nil
    rescue RubyLLM::Error => e
      LogService.log(:error, "SelectorDetector", "pagination — LLM request failed: #{e.message}")
      nil
    end

    private

    # Only guards against totally invented URLs — doesn't verify the matched
    # href is actually the pagination link.
    def template_matches_real_href?(template, links)
      return false unless template

      placeholder = "PAGINATION_NUMBER"
      pattern = Regexp.new("\\A" + Regexp.escape(template.gsub("{page}", placeholder)).gsub(placeholder, "\\d+") + "\\z")
      links.any? { |link| link.match?(pattern) }
    end

    def detect(html, prompt_fn, label)
      return nil if html.blank?

      skeleton = build_skeleton(html)
      return nil if skeleton.blank?

      content = ask_llm(skeleton, prompt_fn, label)
      return nil unless content

      selector = content["selector"]
      valid_selector?(selector) ? selector : nil
    end

    def ask_llm(skeleton, prompt_fn, label)
      result, elapsed_ms = timed { RubyLLM.chat.with_schema(SelectorSchema).ask(prompt_fn.call(skeleton)) }
      LogService.log(:info, "SelectorDetector",
        "#{label} — selector=#{result.content&.dig("selector")} model=#{result.model_id} input_tokens=#{result.tokens.input} output_tokens=#{result.tokens.output} elapsed_ms=#{elapsed_ms}")
      result.content
    rescue RubyLLM::ContextLengthExceededError
      LogService.log(:error, "SelectorDetector", "#{label} — skeleton exceeded context length")
      nil
    rescue RubyLLM::Error => e
      LogService.log(:error, "SelectorDetector", "#{label} — LLM request failed: #{e.message}")
      nil
    end

    def timed
      t0 = Time.now
      result = yield
      [result, ((Time.now - t0) * 1000).round]
    end
  end
end
