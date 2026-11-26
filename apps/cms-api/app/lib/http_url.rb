require "uri"

module HttpUrl
  def self.valid?(value)
    uri = URI.parse(URI::RFC2396_PARSER.escape(value.to_s))
    uri.is_a?(URI::HTTP) && uri.host.present?
  rescue URI::InvalidURIError
    false
  end
end
