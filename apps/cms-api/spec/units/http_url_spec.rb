require_relative "../unit_spec_helper"
require_relative "../../app/lib/http_url"

RSpec.describe HttpUrl do
  describe ".valid?" do
    ["https://example.com/help", "https://www.example.com/help?a=1", "HTTP://example.com", "http://localhost:3000",
      "http://192.168.0.1:8080/feed", "https://bücher.example/", "https://example.com/página"].each do |url|
      it "accepts #{url}" do
        expect(HttpUrl).to be_valid(url)
      end
    end

    ["asdf", "https://", "ftp://example.com", "mailto:help@example.com", "http://example.com:port"].each do |url|
      it "refuses #{url}" do
        expect(HttpUrl).not_to be_valid(url)
      end
    end

    [nil, ""].each do |url|
      it "refuses #{url.inspect}" do
        expect(HttpUrl).not_to be_valid(url)
      end
    end
  end
end
