require "nokogiri"
require "tempfile"
require_relative "http_client"
require_relative "html_helper"
require_relative "selector_detector"

module SourceIngestors
  class Website
    include HtmlHelper

    PREVIEW_LIMIT = 5

    def initialize(config = {})
      @base_url = config["base_url"]
      uses_pagination = @base_url.to_s.include?("{page}")
      @pagination_start = config.fetch("pagination_start", 1)
      @pagination_end = config.fetch("pagination_end", uses_pagination ? 100 : 1)
      @post_link_selector = config["post_link_selector"]
      @title_selector = config["title_selector"]
      @body_selector = config["body_selector"]
      @limit = config["limit"]
      @external_id_selector = config["external_id_selector"]
      @headers = config["headers"] || {}
      @total_selector = config["total_selector"]
      @http_client = HttpClient.new(user_agent: config[:user_agent])
    end

    def call(existing_documents_scope: nil, deleted_documents_scope: nil)
      return [[], nil, nil, nil, nil] if @base_url.nil? || @title_selector.nil? || @body_selector.nil? || @post_link_selector.nil?

      @existing_docs_scope = existing_documents_scope
      @deleted_docs_scope = deleted_documents_scope

      run_ingestion(limit: @limit)
    end

    def preview
      return [[], nil, nil, nil, nil] if @base_url.nil? || @title_selector.nil? || @body_selector.nil? || @post_link_selector.nil?

      [@post_link_selector, @title_selector, @body_selector, @external_id_selector, @total_selector].compact.each do |selector|
        raise "Invalid CSS selector '#{selector}'" unless valid_selector?(selector)
      end

      @any_post_links_found = false
      @any_post_content_found = false
      documents, total, suggested_name = run_ingestion(limit: PREVIEW_LIMIT, strict: true)

      raise "CSS selector '#{@post_link_selector}' did not match any links on the listing page" unless @any_post_links_found
      raise "CSS selectors '#{@title_selector}' and '#{@body_selector}' did not match any content on the previewed post pages" unless @any_post_content_found

      [documents, total, suggested_name, nil, nil]
    end

    def configure
      paginated = template_paginated(@base_url)
      listing_url = paginated ? paginated.gsub("{page}", "1") : @base_url

      listing_response = @http_client.get(listing_url)
      raise HttpClient::FetchFailedError, "Failed to fetch #{listing_url}: #{listing_response.code}" unless listing_response.success?

      detector = SelectorDetector.new
      multi_page, suggested_website_url =
        if paginated
          [true, paginated]
        else
          begin
            paginated = pattern_match_pagination(listing_response.body, listing_url) || detector.detect_pagination(listing_response.body, listing_url)
            [!!paginated, paginated]
          rescue
            [nil, nil]
          end
        end
      pagination_result = {multi_page: multi_page, suggested_website_url: suggested_website_url}

      link_selector = detector.detect_link(listing_response.body)
      return {type: nil, selectors: {}, pagination: pagination_result} unless link_selector

      article_url = resolve_article_url(listing_response.body, link_selector, listing_url)
      return {type: nil, selectors: {}, pagination: pagination_result} unless article_url

      article_response = @http_client.get(article_url)
      return {type: nil, selectors: {}, pagination: pagination_result} unless article_response.success?

      article = detector.detect_article(article_response.body)
      {
        type: article[:platform],
        selectors: {link: link_selector, title: article[:title], body: article[:body]},
        pagination: pagination_result
      }
    end

    def as_file(doc_data)
      tempfile = Tempfile.new(["website_post_", ".txt"])
      tempfile.write("#{doc_data[:title]}\n\n#{doc_data[:content]}")
      tempfile.rewind
      tempfile.path
    end

    def refresh_supported?
      true
    end

    def refetch_document_data(data)
      url = data[:url]
      doc_data = extract_post_data(url)
      raise "Could not extract updated content from #{url}" if doc_data[:error]
      doc_data
    end

    private

    def resolve_article_url(html, selector, base_url)
      clean_doc = remove_non_content_tags(Nokogiri::HTML(html))
      node = clean_doc.css(selector).first
      return nil unless node
      link = (node.name == "a") ? node : node.at_css("a")
      return nil unless link
      href = link["href"]
      return nil if href.blank?
      href.start_with?("http") ? href : URI.join(base_url, href).to_s
    end

    def run_ingestion(limit: nil, strict: false)
      documents = []
      errors = []
      total = nil
      total_seen = 0
      suggested_name = nil

      catch(:abort_ingestion) do
        (@pagination_start..@pagination_end).each do |page|
          page_url = @base_url.gsub("{page}", page.to_s)
          begin
            listing_html = fetch_html(page_url)
          rescue HttpClient::FetchFailedError => e
            raise if page == @pagination_start || ![404, 410].include?(e.code)
            break
          end
          suggested_name ||= listing_html.at_css("title")&.text&.strip.presence || @base_url
          post_urls = extract_post_links(listing_html, page_url)
          total ||= extract_total(listing_html)
          total_seen += post_urls.size
          break if post_urls.empty?
          @any_post_links_found = true

          post_urls.each do |post_url|
            begin
              doc_data = extract_post_data(post_url)
            rescue => e
              raise if strict
              errors << {external_id: post_url, title: post_url, link: post_url, reason: "fetch_failed", details: e.message}
              next
            end
            throw :abort_ingestion if doc_data[:error] == :abort
            next if doc_data[:error] == :skip
            @any_post_content_found = true
            documents << doc_data
            break if limit && documents.size >= limit
          end

          break if limit && documents.size >= limit
        end
      end

      [documents, total || total_seen, suggested_name, errors, nil]
    end

    def fetch_html(url)
      default_headers = {
        "Accept" => "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language" => "en-US,en;q=0.9"
      }
      response = @http_client.get(url, headers: default_headers.merge(@headers))
      raise HttpClient::FetchFailedError.new("Failed to fetch #{url}: #{response.code}", code: response.code) unless response.success?

      remove_non_content_tags(Nokogiri::HTML(response.body))
    end

    def extract_total(html_doc)
      return unless @total_selector

      html_doc.at_css(@total_selector)&.text&.strip&.match(/\d+/)&.to_a&.first&.to_i
    end

    def extract_post_links(html_doc, base_url)
      html_doc.css(@post_link_selector).filter_map do |node|
        link = (node.name == "a") ? node : node.at_css("a")
        next unless link
        href = link["href"]
        next if href.blank? || href.start_with?("mailto:")
        href.start_with?("http") ? href : URI.join(base_url, href).to_s
      end.uniq
    end

    def extract_post_data(post_url)
      if @external_id_selector
        html_doc = fetch_html(post_url)
        external_id = html_doc.at_css(@external_id_selector)&.text&.strip
      else
        external_id = post_url
      end

      # Abort pagination if already ingested — signals caller to stop fetching further pages
      return {error: :abort} if @existing_docs_scope&.exists?(external_id: external_id) || @deleted_docs_scope&.exists?(external_id: external_id)

      html_doc ||= fetch_html(post_url)
      title = html_doc.at_css(@title_selector)&.text&.strip.to_s
      body = html_doc.css(@body_selector).map(&:text).join("\n").strip.to_s

      return {error: :skip} if title.empty? || body.empty?

      {
        external_id: external_id,
        title: title,
        content: body,
        metadata: {url: post_url},
        link: post_url,
        public_url: post_url,
        document_type: "blog_post"
      }
    end
  end
end
