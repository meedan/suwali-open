require "httparty"
require "ipaddr"
require "resolv"
require_relative "file_constraints"

module SourceIngestors
  class HttpClient
    include FileConstraints

    TIMEOUT_SECONDS = 60

    BLOCKED_IP_RANGES = [
      IPAddr.new("10.0.0.0/8"),     # RFC 1918 private
      IPAddr.new("172.16.0.0/12"),  # RFC 1918 private
      IPAddr.new("192.168.0.0/16"), # RFC 1918 private
      IPAddr.new("127.0.0.0/8"),    # Loopback
      IPAddr.new("169.254.0.0/16"), # Link-local (includes AWS metadata endpoint)
      IPAddr.new("0.0.0.0/8"),      # Unroutable
      IPAddr.new("::1/128"),        # IPv6 loopback
      IPAddr.new("fc00::/7"),       # IPv6 unique-local
      IPAddr.new("fe80::/10")      # IPv6 link-local
    ].freeze

    class ResponseTooLargeError < StandardError; end

    class InvalidUrlError < StandardError; end

    class FetchFailedError < StandardError
      attr_reader :code

      def initialize(message = nil, code: nil)
        super(message)
        @code = code
      end
    end

    Response = Struct.new(:code, :message, :body, :content_type, :headers) do
      def success?
        code.between?(200, 299)
      end
    end

    class PinnedAddressAdapter < HTTParty::ConnectionAdapter
      def connection
        http = super
        http.ipaddr = validated_address
        http
      end

      private

      def validated_address
        host = clean_host(uri.host)
        addresses = Resolv.getaddresses(host)
        raise InvalidUrlError, "Could not resolve host: #{host}" if addresses.empty?
        blocked = addresses.find { |addr| blocked_ip?(addr) }
        raise InvalidUrlError, "Blocked address: #{blocked}" if blocked
        addresses.first
      end

      def blocked_ip?(addr)
        ip = IPAddr.new(addr)
        ip = ip.native if ip.ipv4_mapped?
        BLOCKED_IP_RANGES.any? { |range| range.include?(ip) }
      end
    end

    def initialize(user_agent:)
      @user_agent = user_agent
    end

    # Credentials are only sent to the URL given: a redirect comes back as a 3xx response instead of
    # being followed, so it cannot carry them to another host
    def get(url, params: {}, headers: {}, basic_auth: nil)
      merged_headers = default_headers.merge(headers)
      options = {headers: merged_headers, timeout: TIMEOUT_SECONDS, stream_body: true,
                 connection_adapter: PinnedAddressAdapter}
      options[:query] = params if params.any?
      if basic_auth
        options[:basic_auth] = basic_auth
        options[:follow_redirects] = false
      end

      body = +""
      url = validated_url(url)

      response = HTTParty.get(url, options) do |fragment|
        # When following redirects, the block also yields the intermediate
        # responses' bodies. Discard those so we only keep the final response.
        if fragment.code.between?(300, 399)
          body.clear
          next
        end

        body << fragment.to_s
        if body.bytesize > MAX_SIZE_BYTES
          raise ResponseTooLargeError, "Response from #{url} exceeded #{MAX_SIZE_BYTES} bytes"
        end
      end

      Response.new(response.code, response.message, body, response.headers["Content-Type"].to_s, response.headers)
    end

    # The body is discarded unread, so a large one cannot get around MAX_SIZE_BYTES
    def delete(url, basic_auth:)
      options = {headers: default_headers, timeout: TIMEOUT_SECONDS, stream_body: true,
                 connection_adapter: PinnedAddressAdapter, basic_auth: basic_auth, follow_redirects: false}
      response = HTTParty.delete(validated_url(url), options) { |_fragment| }

      Response.new(response.code, response.message, "", response.headers["Content-Type"].to_s, response.headers)
    end

    private

    def default_headers
      {
        "User-Agent" => @user_agent
      }
    end

    def validated_url(url)
      encoded = Addressable::URI.encode(url)
      scheme = Addressable::URI.parse(encoded).scheme
      raise InvalidUrlError, "Invalid scheme: #{scheme}" unless ["http", "https"].include?(scheme)
      encoded
    rescue Addressable::URI::InvalidURIError
      raise InvalidUrlError, "Malformed URL: #{url}"
    end
  end
end
