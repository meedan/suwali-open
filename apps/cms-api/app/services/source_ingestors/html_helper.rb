module SourceIngestors
  module HtmlHelper
    NON_CONTENT_TAGS = %w[script style noscript].freeze

    SKELETON_STRIP_TAGS = %w[
      svg iframe
      header footer nav aside form
      figure picture video audio
    ].freeze | NON_CONTENT_TAGS

    HTML_MAX_CHARS = 15_000

    PAGINATION_PATTERN = %r{[?&](?:page|p)=\d+|/(?:page|p)/\d+/?(?:\z|[?#])}i

    def remove_non_content_tags(html_doc)
      NON_CONTENT_TAGS.each { |tag| html_doc.css(tag).remove }
      html_doc
    end

    def prepare_body(raw_html)
      doc = Nokogiri::HTML(raw_html)
      body = doc.at_css("body") || doc
      SKELETON_STRIP_TAGS.each { |tag| body.css(tag).remove }
      body.xpath(".//comment()").remove
      body.traverse do |node|
        next unless node.element?
        keep = node.attributes.keys & %w[class id]
        node.attributes.each_key { |k| node.remove_attribute(k) unless keep.include?(k) }
      end
      body
    end

    def valid_selector?(selector)
      Nokogiri::HTML("").at_css(selector)
      true
    rescue Nokogiri::CSS::SyntaxError
      false
    end

    def build_skeleton(raw_html)
      body = prepare_body(raw_html)
      body = body.at_css("main") || body

      # Remove text nodes entirely — the LLM only needs class/id structure.
      body.xpath(".//text()").each(&:remove)

      # Unwrap elements with neither class nor id: they can't be CSS-targeted
      # and only add nesting depth. Work bottom-up so children are processed first.
      body.xpath(".//*[not(@class) and not(@id)]").reverse_each { |node| node.replace(node.children) }
      body.inner_html.gsub(/\s+/, " ").strip.slice(0, HTML_MAX_CHARS).presence
    end

    def discover_feed(html, base_url)
      doc = Nokogiri::HTML(html)

      link = doc.at_css(
        'link[rel~="alternate"][type="application/rss+xml"], ' \
        'link[rel~="alternate"][type="application/atom+xml"]'
      )

      return unless link

      URI.join(base_url, link["href"]).to_s
    end

    def fetch_link(http_client, url, rel)
      response = http_client.get(url)
      return unless response.success?

      href = link_header_href(response.headers&.[]("link"), rel) ||
        Nokogiri::HTML(response.body.to_s).at_css("head > link[rel='#{rel}']")&.[]("href")
      return if href.blank?

      link = Addressable::URI.join("#{url.chomp("/")}/", href).to_s
      if Addressable::URI.parse(link).host&.downcase != Addressable::URI.parse(url).host&.downcase
        LogService.log(:info, "HtmlHelper", "Ignoring the #{rel} link #{link} that #{url} declares on another host")
        return
      end

      link
    rescue => e
      LogService.log(:warn, "HtmlHelper", "Could not discover the #{rel} link for #{url}: #{e.message}")
      nil
    end

    def fetch_link_from_url_or_origin(http_client, url, rel)
      [url, Addressable::URI.parse(url).origin].uniq.each do |candidate|
        link = fetch_link(http_client, candidate, rel)
        return link if link
      end
      nil
    end

    def link_header_href(header, rel)
      header.to_s.split(",").each do |link|
        match = link.match(/<([^>]+)>\s*;\s*rel="#{Regexp.escape(rel)}"/)
        return match[1] if match
      end
      nil
    end

    def pattern_match_pagination(html, base_url)
      return if html.blank?

      links = strip_header_footer(html).css("a[href]").map { |a| resolve_url(base_url, a["href"]) }
      paginated = links.find { |link| link.match?(PAGINATION_PATTERN) }
      return unless paginated

      template_paginated(paginated)
    end

    def strip_header_footer(html)
      doc = Nokogiri::HTML(html)
      body = doc.at_css("body") || doc
      body.css("header, footer").remove
      body
    end

    def template_paginated(url)
      return url if url.include?("{page}")
      return unless url.match?(PAGINATION_PATTERN)

      url.sub(PAGINATION_PATTERN) do |match|
        match.sub(/\d+/, "{page}")
      end
    end

    def resolve_url(base_url, href)
      href.start_with?("http") ? href : URI.join(base_url, href).to_s
    end
  end
end
