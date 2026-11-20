require "nokogiri"
require "tempfile"
require "json"
require "time"
require_relative "http_client"
require_relative "html_helper"

module SourceIngestors
  class WordpressApi
    include HtmlHelper

    PREVIEW_LIMIT = 5
    # WordPress allows up to 100 per page, but full post bodies can push that past HttpClient's
    # response size limit on long-form sites.
    PAGE_SIZE = 20
    # A sync stops at the first post it already has, so the first one must read the whole site or
    # older posts are never reached. 500 x 20 matches SourceIngestionWorker::MAX_NUMBER_OF_DOCUMENTS.
    MAX_PAGES = 500
    API_NAMESPACE = "wp/v2"

    API_DISCOVERY_REL = "https://api.w.org/"
    WPCOM_API_HOST = "https://public-api.wordpress.com"
    CONTENT_TYPES = %w[posts pages].freeze
    POST_FIELDS = "id,link,date,date_gmt,title,content,excerpt"
    UUID_FORMAT = /\A\h{8}-\h{4}-\h{4}-\h{4}-\h{12}\z/

    # status is :verified, :not_admin, or :rejected when the site refused the credentials
    AdministratorCheck = Struct.new(:status, :password_revoked)

    class SiteCheckFailedError < StandardError; end

    def initialize(config = {})
      @site_url = self.class.normalize_site_url(config["site_url"])
      @content_type = CONTENT_TYPES.include?(config["content_type"]) ? config["content_type"] : "posts"
      @hub_id = config[:hub_id]
      @stored_api_base = config["api_base"].presence
      @http_client = HttpClient.new(user_agent: config[:user_agent])
    end

    def call(existing_documents_scope: nil, deleted_documents_scope: nil)
      return [[], nil, nil, nil, nil] if @site_url.blank?

      @existing_docs_scope = existing_documents_scope
      @deleted_docs_scope = deleted_documents_scope

      documents, total = fetch_posts
      [documents, total, nil, nil, nil]
    end

    def preview
      return [[], nil, nil, nil, nil] if @site_url.blank?

      documents, total = fetch_posts(limit: PREVIEW_LIMIT)
      [documents, total, site_name, nil, @site_url]
    end

    def as_file(doc_data)
      tempfile = Tempfile.new(["wordpress_post_", ".txt"])
      tempfile.write("#{doc_data[:title]}\n\nDate: #{doc_data[:date]}\n\n#{doc_data[:content]}")
      tempfile.rewind
      tempfile.path
    end

    def refresh_supported?
      true
    end

    def self.normalize_site_url(url)
      return nil if url.blank?

      uri = Addressable::URI.parse(url.to_s.strip)
      return nil unless %w[http https].include?(uri.scheme&.downcase) && uri.host.present?
      return nil if uri.userinfo.present? || (uri.port && uri.port != uri.default_port)

      path = uri.path.sub(%r{/wp-json(/.*)?\z}, "").chomp("/")
      "#{uri.scheme.downcase}://#{uri.host.downcase}#{path}"
    rescue Addressable::URI::InvalidURIError
      nil
    end

    def self.detect_site_url(url, user_agent:)
      new({"site_url" => url, :user_agent => user_agent}).detect_site_url
    end

    def detect_site_url
      return nil if @site_url.blank?
      return "https://#{site_host}" if wpcom_subdomain?

      root = fetch_link_from_url_or_origin(@http_client, @site_url, API_DISCOVERY_REL)
      return self.class.normalize_site_url(root)&.delete_suffix("/index.php") if root

      api_index_site_url
    end

    # For sites that hide the API link but still serve the API index; home may differ from the site's host by www.
    def api_index_site_url
      origin = Addressable::URI.parse(@site_url).origin
      response = @http_client.get("#{origin}/wp-json/", params: {"_fields" => "home,namespaces"})
      return nil unless response.success?

      data = JSON.parse(response.body)
      return nil unless data.is_a?(Hash) && Array(data["namespaces"]).include?(API_NAMESPACE)

      home = self.class.normalize_site_url(data["home"])
      return origin if home.nil?

      (url_host(home).delete_prefix("www.") == site_host.delete_prefix("www.")) ? home : nil
    rescue => e
      LogService.log(:info, "WordpressApi", "Could not read the API index of #{@site_url}: #{e.message}")
      nil
    end

    def api_base
      @api_base ||= @stored_api_base || detect_api_base
    end

    def tagline_includes?(code)
      cache_buster = SecureRandom.hex(4)
      response = if wpcom_api?
        @http_client.get(wpcom_site_info_url, params: {"fields" => "description", "_" => cache_buster})
      else
        @http_client.get(api_root, params: {"_fields" => "description", "_" => cache_buster})
      end
      raise SiteCheckFailedError, "Could not read the tagline of #{@site_url}: status #{response.code}" unless response.success?

      data = parse_json(response.body)
      tagline = data.is_a?(Hash) ? html_to_text(data["description"]) : ""
      tagline.downcase.include?(code.downcase)
    end

    # Where the site's admin can approve Suwali, when the site supports Application Passwords
    def application_passwords_authorization_url
      return nil unless credentials_safe?

      response = @http_client.get(api_root, params: {"_fields" => "authentication"})
      return nil unless response.success?

      data = parse_json(response.body)
      url = data.dig("authentication", "application-passwords", "endpoints", "authorization") if data.is_a?(Hash)
      (url.is_a?(String) && url.start_with?("https://") && url_host(url) == site_host) ? url : nil
    rescue => e
      LogService.log(:warn, "WordpressApi", "Could not check whether #{@site_url} supports Application Passwords: #{e.message}")
      nil
    end

    def check_administrator(user_login, password)
      raise SiteCheckFailedError, "#{@site_url} cannot be verified with an Application Password" unless credentials_safe?

      credentials = {username: user_login.to_s, password: password.to_s}
      begin
        status = administrator_status(credentials)
      ensure
        password_revoked = status != :rejected && revoke_application_password(credentials)
      end
      AdministratorCheck.new(status, password_revoked)
    end

    def refetch_document_data(data)
      post_id = data[:external_id]
      response = @http_client.get("#{posts_url}/#{post_id}", params: {"_fields" => POST_FIELDS})
      raise "Could not fetch WordPress post #{post_id}: status #{response.code}" unless response.success?

      doc_data = build_document_data(parse_json(response.body))
      raise "Could not extract updated content from WordPress post #{post_id}" if doc_data[:error]

      doc_data
    end

    private

    def fetch_posts(limit: nil)
      documents = []
      total = nil

      (1..MAX_PAGES).each do |page|
        response = fetch_page(page, limit || PAGE_SIZE)
        # Without X-WP-TotalPages, WordPress answers a page past the end with a 400
        break if response.nil?

        total ||= response.headers&.[]("X-WP-Total")&.to_i
        posts = parse_json(response.body)
        raise "#{@site_url} did not return a list of WordPress posts" unless posts.is_a?(Array)
        break if posts.empty?

        posts.each do |post|
          doc_data = extract_post_data(post)
          return [documents, total] if doc_data[:error] == :abort
          next if doc_data[:error] == :skip

          documents << doc_data
          return [documents, total] if limit && documents.size >= limit
        end

        total_pages = response.headers&.[]("X-WP-TotalPages").to_i
        break if total_pages.positive? && page >= total_pages
      end

      [documents, total || documents.size]
    end

    def fetch_page(page, per_page)
      response = @http_client.get(posts_url, params: {
        "page" => page,
        "per_page" => per_page,
        "orderby" => "date",
        "order" => "desc",
        "_fields" => POST_FIELDS
      })
      return nil if page > 1 && response.code == 400
      raise "WordPress API request to #{posts_url} failed with status #{response.code}" unless response.success?

      response
    end

    def extract_post_data(post)
      return {error: :skip} unless post.is_a?(Hash)

      external_id = post["id"].to_s
      return {error: :skip} if external_id.blank?
      return {error: :abort} if already_imported?(external_id)

      build_document_data(post)
    end

    def build_document_data(post)
      return {error: :skip} unless post.is_a?(Hash)
      return {error: :skip} if post.dig("content", "protected")

      title = html_to_text(post.dig("title", "rendered"))
      content = html_to_text(post.dig("content", "rendered"))
      excerpt = html_to_text(post.dig("excerpt", "rendered"))
      return {error: :skip} if title.blank? && content.blank?

      link = post["link"].presence
      published_at = parse_published_at(post)

      {
        external_id: post["id"].to_s,
        title: title.presence || content.truncate(80),
        content: content.presence || excerpt,
        date: published_at,
        link: link,
        metadata: {
          url: link,
          published_at: published_at,
          description: excerpt
        },
        document_type: "blog_post"
      }
    end

    def already_imported?(external_id)
      @existing_docs_scope&.exists?(external_id: external_id) || @deleted_docs_scope&.exists?(external_id: external_id)
    end

    def site_name
      response = if wpcom_api?
        @http_client.get(wpcom_site_info_url, params: {"fields" => "name"})
      else
        @http_client.get(api_root, params: {"_fields" => "name"})
      end
      data = response.success? ? parse_json(response.body) : nil
      name = data.is_a?(Hash) ? html_to_text(data["name"]) : nil
      name.presence || @site_url
    rescue => e
      LogService.log(:warn, "WordpressApi", "Could not fetch site name for #{@site_url}: #{e.message}")
      @site_url
    end

    def parse_json(body)
      JSON.parse(body)
    rescue JSON::ParserError
      raise "#{@site_url} did not return a valid WordPress API response"
    end

    # WordPress renders titles and bodies as HTML with encoded entities (e.g. &#8217;)
    def html_to_text(html)
      return "" if html.blank?

      remove_non_content_tags(Nokogiri::HTML.fragment(html.to_s)).text.squish
    end

    # date_gmt is UTC without a zone designator; date is in the site's own timezone
    def parse_published_at(post)
      if post["date_gmt"].present?
        Time.iso8601("#{post["date_gmt"]}Z")
      elsif post["date"].present?
        Time.zone.parse(post["date"])
      end
    rescue ArgumentError
      nil
    end

    def posts_url
      "#{api_base}/#{@content_type}"
    end

    def api_root
      api_base.delete_suffix(API_NAMESPACE)
    end

    def detect_api_base
      return wpcom_api_base if wpcom_subdomain?

      root = discover_api_root
      return "#{root}#{API_NAMESPACE}" if root
      return wpcom_api_base if hosted_on_wpcom?

      "#{@site_url}/wp-json/#{API_NAMESPACE}"
    end

    def discover_api_root
      root = fetch_link(@http_client, @site_url, API_DISCOVERY_REL)
      return nil if root.nil?

      root.end_with?("/") ? root : "#{root}/"
    end

    def credentials_safe?
      !wpcom_api? && api_base.start_with?("https://") && url_host(api_base) == site_host
    end

    def administrator_status(credentials)
      response = @http_client.get("#{api_base}/users/me", params: {"context" => "edit", "_fields" => "capabilities"},
        basic_auth: credentials)
      return :rejected if [401, 403].include?(response.code)
      raise SiteCheckFailedError, "Could not check your account on #{@site_url}: status #{response.code}" unless response.success?

      data = parse_json(response.body)
      (data.is_a?(Hash) && data.dig("capabilities", "manage_options") == true) ? :verified : :not_admin
    end

    # Needs WordPress 5.7 or later, which can tell a password its own ID
    def revoke_application_password(credentials)
      response = @http_client.get("#{api_base}/users/me/application-passwords/introspect", params: {"_fields" => "uuid"},
        basic_auth: credentials)
      data = response.success? ? parse_json(response.body) : nil
      uuid = data["uuid"].to_s if data.is_a?(Hash)
      return false unless uuid&.match?(UUID_FORMAT)

      @http_client.delete("#{api_base}/users/me/application-passwords/#{uuid}", basic_auth: credentials).success?
    rescue => e
      LogService.log(:warn, "WordpressApi", "Could not revoke the Application Password for #{@site_url}: #{e.message}")
      false
    end

    # WordPress.com also knows Jetpack-connected self-hosted sites, which must be read directly
    def hosted_on_wpcom?
      response = @http_client.get(wpcom_site_info_url, params: {"fields" => "ID,jetpack"})
      return false unless response.success?

      data = JSON.parse(response.body)
      data.is_a?(Hash) && data["ID"].present? && !data["jetpack"]
    rescue => e
      LogService.log(:warn, "WordpressApi", "Could not check whether #{@site_url} is hosted on WordPress.com: #{e.message}")
      false
    end

    def wpcom_api_base
      "#{WPCOM_API_HOST}/#{API_NAMESPACE}/sites/#{site_host}"
    end

    def wpcom_site_info_url
      "#{WPCOM_API_HOST}/rest/v1.1/sites/#{site_host}"
    end

    def wpcom_api?
      api_base.start_with?("#{WPCOM_API_HOST}/")
    end

    def wpcom_subdomain?
      site_host.to_s.end_with?(".wordpress.com")
    end

    def site_host
      @site_host ||= url_host(@site_url)
    end

    def url_host(url)
      Addressable::URI.parse(url).host&.downcase
    rescue Addressable::URI::InvalidURIError
      nil
    end
  end
end
