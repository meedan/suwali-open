require "nokogiri"
require "tempfile"
require "feedjira"
require_relative "http_client"
require_relative "html_helper"
require_relative "selector_detector"

module SourceIngestors
  class RssFeed
    include HtmlHelper

    PREVIEW_LIMIT = 5

    def initialize(config = {})
      @feed_url = config["feed_url"]
      @expanded_description_selector = config["expanded_description_selector"]
      @headers = config["headers"] || {}
      @http_client = HttpClient.new(user_agent: config[:user_agent])
    end

    def call(existing_documents_scope: nil, deleted_documents_scope: nil)
      return [[], nil, nil, nil, nil] if @feed_url.blank?

      @existing_docs_scope = existing_documents_scope
      @deleted_docs_scope = deleted_documents_scope

      run_ingestion
    end

    def preview
      return [[], nil, nil, nil, nil] if @feed_url.blank?

      if @expanded_description_selector.present? && !valid_selector?(@expanded_description_selector)
        raise "Invalid CSS selector '#{@expanded_description_selector}'"
      end

      @limit = PREVIEW_LIMIT
      @article_pages_attempted = false
      @any_article_page_loaded = false
      @selector_failed = false
      documents, total, suggested_name, _, suggested_feed_url = run_ingestion(strict: true)

      if @expanded_description_selector.present?
        raise "CSS selector '#{@expanded_description_selector}' could not be tested: no article pages could be loaded" if @article_pages_attempted && !@any_article_page_loaded
        raise "CSS selector '#{@expanded_description_selector}' did not match any content on the previewed article pages" if @selector_failed
      end

      [documents, total, suggested_name, nil, suggested_feed_url]
    end

    def configure
      parsed_feed, = resolve_feed

      feed_entry = parsed_feed.entries.first
      return {type: nil, selectors: {}} if feed_entry.nil?

      return {type: "feed", selectors: {}} if feed_entry.content.present? && full_article_content?(feed_entry.content&.strip)
      return {type: "feed", selectors: {}} if full_article_content?(feed_entry.summary&.strip)

      article_url = feed_entry.url&.to_s&.strip
      return {type: nil, selectors: {}} if article_url.blank?

      article_response = @http_client.get(article_url)
      body_selector = article_response.success? ? SelectorDetector.new.detect_body(article_response.body) : nil
      return {type: "css", selectors: {body: body_selector}} if body_selector

      {type: nil, selectors: {}}
    end

    def as_file(doc_data)
      tempfile = Tempfile.new(["rss_feed_entry_", ".txt"])
      tempfile.write("#{doc_data[:title]}\n\nDate: #{doc_data[:date]}\n\n#{doc_data[:content]}")
      tempfile.rewind
      tempfile.path
    end

    def refresh_supported?
      @expanded_description_selector.present?
    end

    def refetch_document_data(data)
      raise Document::RefreshNotSupportedError unless refresh_supported?

      link = data[:url]
      html_doc = fetch_article_page(link)
      fetched = html_doc && extract_selector_content(html_doc)
      raise "Could not extract updated content from #{link}" if fetched.blank?

      {title: data[:title], content: fetched, metadata: data[:metadata]}
    end

    private

    def run_ingestion(strict: false)
      parsed_feed, suggested_feed_url = resolve_feed

      documents = []
      total = 0
      suggested_name = nil

      begin
        total = parsed_feed.entries.size
        suggested_name = parsed_feed.title.presence || @feed_url
        catch(:abort_ingestion) do
          parsed_feed.entries.each do |entry|
            doc_data = extract_rss_item_data(entry, strict: strict)
            throw :abort_ingestion if doc_data[:error] == :abort
            next if doc_data[:error] == :skip
            if doc_data[:error] == :selector_not_found
              @selector_failed = true
              throw :abort_ingestion
            end
            documents << doc_data
            break if @limit && documents.size >= @limit
          end
        end
      rescue => e
        raise "Failed to process RSS feed #{@feed_url}: #{e.message}"
      end

      [documents, total, suggested_name, nil, suggested_feed_url]
    end

    def extract_rss_item_data(entry, strict: false)
      link = entry.url&.to_s&.strip
      published_at = entry.published
      description = stripped_feed_tag(entry.summary)
      title = stripped_feed_tag(entry.title) || description&.truncate(80)

      fetchable = link.present? && (@expanded_description_selector.present? || entry.content.present?)
      return {error: :skip} if title.blank? && description.blank? && !fetchable

      # nosemgrep: ruby.lang.security.weak-hashes-md5.weak-hashes-md5 -- RSS dedup identity for feeds with no guid or link, not a security primitive
      guid = entry.entry_id || entry.id || link || Digest::MD5.hexdigest(title)
      return {error: :abort} if already_imported?(guid)

      full_content = nil
      begin
        if @expanded_description_selector.blank? && entry.content.present?
          full_content = stripped_feed_tag(entry.content)
        elsif @expanded_description_selector && link.present?
          html_doc = fetch_article_page(link)
          if html_doc
            fetched = extract_selector_content(html_doc)
            if fetched.present?
              full_content = fetched
            elsif strict
              return {error: :selector_not_found}
            end
          end
        end
      rescue
        # Log error but continue with just the description
      end

      content = full_content.present? ? "#{description}\n\n#{full_content}" : description || title
      {
        external_id: guid,
        title: title,
        content: content,
        date: published_at,
        link: link,
        metadata: {
          url: link,
          published_at: published_at,
          description: description
        },
        document_type: "rss_entry"
      }
    end

    def already_imported?(guid)
      @existing_docs_scope&.exists?(external_id: guid) || @deleted_docs_scope&.exists?(external_id: guid)
    end

    def stripped_feed_tag(tag)
      ActionController::Base.helpers.strip_tags(tag&.to_s&.strip)&.squish
    end

    def fetch_article_page(url)
      return nil if url.blank?

      @article_pages_attempted = true
      response = @http_client.get(url, headers: @headers)
      return nil unless response.success?

      @any_article_page_loaded = true
      html_doc = Nokogiri::HTML(response.body)
      remove_non_content_tags(html_doc)
      html_doc
    end

    def extract_selector_content(html_doc)
      html_doc.at_css(@expanded_description_selector)&.text&.to_s&.strip&.squish
    end

    def full_article_content?(text)
      text.present? && text.length >= 1000 && !text.match?(/(\.\.\.|…|\[[\.\…]+\])\s*\z/)
    end

    def resolve_feed
      response = fetch!(@feed_url)

      begin
        [Feedjira.parse(response.body), nil]
      rescue Feedjira::NoParserAvailable
        suggested_feed_url = discover_feed(response.body.to_s, @feed_url)
        raise "No RSS feed found at #{@feed_url}" unless suggested_feed_url

        [Feedjira.parse(fetch!(suggested_feed_url).body), suggested_feed_url]
      end
    end

    def fetch!(url)
      response = @http_client.get(url, headers: @headers)
      raise "Failed to fetch RSS feed #{url}: #{response.code}" unless response.success?
      response
    end
  end
end
