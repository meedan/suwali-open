require_relative "../unit_spec_helper"
require_relative "../../app/services/source_ingestors/http_client"

require "webmock/rspec"
WebMock.disable_net_connect!(allow_localhost: true)

RSpec.describe SourceIngestors::HttpClient do
  let(:user_agent) { "Suwali/1.0 (Hub 123; +https://suwali.io)" }
  let(:client) { described_class.new(user_agent: user_agent) }

  before do
    allow(Resolv).to receive(:getaddresses).and_call_original
    allow(Resolv).to receive(:getaddresses).with("example.com").and_return(["93.184.216.34"])
  end

  def spy_on_connections
    connections = []
    allow(Net::HTTP).to receive(:new).and_wrap_original do |original, *args|
      original.call(*args).tap { |http| connections << http }
    end
    connections
  end

  describe "PinnedAddressAdapter" do
    let(:adapter) { described_class::PinnedAddressAdapter }

    it "pins the validated address while keeping the hostname for TLS" do
      http = adapter.call(URI.parse("https://example.com/x"), {})

      expect(http.ipaddr).to eq("93.184.216.34")
      expect(http.address).to eq("example.com")
    end

    it "raises when the host resolves to a blocked address" do
      allow(Resolv).to receive(:getaddresses).with("internal.corp").and_return(["10.0.0.5"])

      expect { adapter.call(URI.parse("http://internal.corp/"), {}) }
        .to raise_error(described_class::InvalidUrlError, /Blocked address/)
    end

    it "raises when the host cannot be resolved" do
      allow(Resolv).to receive(:getaddresses).with("nowhere.invalid").and_return([])

      expect { adapter.call(URI.parse("http://nowhere.invalid/"), {}) }
        .to raise_error(described_class::InvalidUrlError, /Could not resolve/)
    end

    it "strips brackets from IPv6 hosts before resolving" do
      expect { adapter.call(URI.parse("http://[::1]/"), {}) }
        .to raise_error(described_class::InvalidUrlError, /Blocked address/)
    end
  end

  describe "#initialize" do
    it "initializes with a user_agent" do
      expect { described_class.new(user_agent: user_agent) }.not_to raise_error
    end

    it "requires a user_agent" do
      expect { described_class.new }.to raise_error(ArgumentError, /user_agent/)
    end
  end

  describe "#get" do
    let(:url) { "https://example.com/api/data" }

    before do
      stub_request(:get, url)
        .to_return(status: 200, body: "response body")
    end

    it "makes an HTTP GET request to the specified URL" do
      client.get(url)
      expect(WebMock).to have_requested(:get, url).once
    end

    it "sends the given User-Agent header" do
      client.get(url)
      expect(WebMock).to have_requested(:get, url)
        .with(headers: {"User-Agent" => "Suwali/1.0 (Hub 123; +https://suwali.io)"})
    end

    it "merges custom headers with default User-Agent" do
      custom_headers = {
        "Authorization" => "Bearer token123",
        "Accept" => "application/json"
      }

      client.get(url, headers: custom_headers)

      expect(WebMock).to have_requested(:get, url)
        .with(headers: {
          "User-Agent" => "Suwali/1.0 (Hub 123; +https://suwali.io)",
          "Authorization" => "Bearer token123",
          "Accept" => "application/json"
        })
    end

    it "allows custom User-Agent to override default User-Agent" do
      custom_headers = {"User-Agent" => "CustomBot/2.0"}

      client.get(url, headers: custom_headers)

      expect(WebMock).to have_requested(:get, url)
        .with(headers: {"User-Agent" => "CustomBot/2.0"})
    end

    it "includes query parameters when provided" do
      stub_request(:get, url)
        .with(query: {"page" => "1", "limit" => "10"})
        .to_return(status: 200, body: "response body")

      params = {"page" => "1", "limit" => "10"}
      client.get(url, params: params)

      expect(WebMock).to have_requested(:get, url)
        .with(query: params)
    end

    it "works without query parameters" do
      client.get(url)

      expect(WebMock).to have_requested(:get, url)
        .with(query: {})
    end

    it "returns a response exposing code, body and success?" do
      response = client.get(url)

      expect(response.body).to eq("response body")
      expect(response.code).to eq(200)
      expect(response.success?).to be(true)
    end

    it "exposes response headers with case-insensitive lookup" do
      stub_request(:get, url).to_return(status: 200, body: "[]", headers: {"X-WP-Total" => "42"})

      response = client.get(url)

      expect(response.headers["x-wp-total"]).to eq("42")
      expect(response.headers["X-WP-Total"]).to eq("42")
    end

    it "raises when the response exceeds the maximum allowed size" do
      stub_const("SourceIngestors::FileConstraints::MAX_SIZE_BYTES", 8)
      stub_request(:get, url).to_return(status: 200, body: "more than eight bytes")

      expect { client.get(url) }.to raise_error(SourceIngestors::HttpClient::ResponseTooLargeError)
    end

    it "follows redirects and returns only the final response body" do
      stub_request(:get, url)
        .to_return(status: 302, headers: {"Location" => "https://example.com/final"}, body: "redirecting...")
      stub_request(:get, "https://example.com/final")
        .to_return(status: 200, body: "final body")

      response = client.get(url)

      expect(response.body).to eq("final body")
      expect(response.code).to eq(200)
    end

    it "follows relative URL redirects" do
      stub_request(:get, url)
        .to_return(status: 301, headers: {"Location" => "/final"})
      stub_request(:get, "https://example.com/final")
        .to_return(status: 200, body: "final body")

      response = client.get(url)

      expect(response.body).to eq("final body")
      expect(response.code).to eq(200)
    end

    it "sends basic auth credentials" do
      client.get(url, basic_auth: {username: "admin", password: "abcd efgh"})

      expect(WebMock).to have_requested(:get, url).with(basic_auth: ["admin", "abcd efgh"])
    end

    it "does not follow redirects when sending credentials, so they cannot reach another host" do
      stub_request(:get, url).to_return(status: 302, headers: {"Location" => "https://elsewhere.example.com/"})

      response = client.get(url, basic_auth: {username: "admin", password: "secret"})

      expect(response.code).to eq(302)
      expect(response.success?).to be(false)
      expect(WebMock).not_to have_requested(:get, "https://elsewhere.example.com/")
    end

    it "makes a request to non-ascii URLs successfully" do
      non_ascii_url = "https://example.com/مقال"
      encoded_url = "https://example.com/%D9%85%D9%82%D8%A7%D9%84"
      stub_request(:get, encoded_url).to_return(status: 200, body: "response body")

      response = client.get(non_ascii_url)

      expect(response.code).to eq(200)
      expect(response.success?).to be(true)
    end

    context "URL validation" do
      it "raises for the ftp:// scheme" do
        expect { client.get("ftp://example.com/file") }
          .to raise_error(described_class::InvalidUrlError, /Invalid scheme/)
      end

      it "raises for a malformed URL" do
        expect { client.get("http://example.com:port") }
          .to raise_error(described_class::InvalidUrlError, /Malformed URL/)
      end

      it "raises for a URL with no hierarchical segment" do
        expect { client.get("http://") }
          .to raise_error(described_class::InvalidUrlError, /Malformed URL/)
      end

      it "accepts the http scheme" do
        stub_request(:get, "http://example.com").to_return(status: 200, body: "ok")

        expect(client.get("http://example.com").code).to eq(200)
      end
    end

    context "SSRF protection" do
      it "raises before making a request when the URL scheme is invalid" do
        expect { client.get("file:///etc/passwd") }.to raise_error(described_class::InvalidUrlError)
      end

      [
        ["10.x.x.x range", "http://10.0.0.1/secret"],
        ["172.16.x.x range", "http://172.16.0.1/secret"],
        ["192.168.x.x range", "http://192.168.1.1/secret"],
        ["the AWS metadata endpoint", "http://169.254.169.254/latest/meta-data"],
        ["the ECS credentials endpoint", "http://169.254.170.2/"],
        ["127.0.0.1", "http://127.0.0.1/secret"],
        ["other addresses in the 127.0.0.0/8 range", "http://127.0.0.2/secret"],
        ["0.0.0.0", "http://0.0.0.0"],
        ["the IPv6 loopback address", "http://[::1]/secret"],
        ["IPv6 link-local addresses", "http://[fe80::1]/secret"],
        ["IPv6 unique-local addresses", "http://[fc00::1]/secret"],
        ["an IPv4-mapped IPv6 loopback address", "http://[::ffff:127.0.0.1]/secret"],
        ["an IPv4-mapped IPv6 metadata address", "http://[::ffff:169.254.169.254]/latest/meta-data"]
      ].each do |description, blocked_url|
        it "raises for #{description} without making a request" do
          expect { client.get(blocked_url) }.to raise_error(described_class::InvalidUrlError)
          expect(WebMock).not_to have_requested(:get, blocked_url)
        end
      end

      it "raises when a hostname resolves to a private IP" do
        allow(Resolv).to receive(:getaddresses).with("internal.corp").and_return(["10.0.0.5"])

        expect { client.get("http://internal.corp/secret") }
          .to raise_error(described_class::InvalidUrlError)
        expect(WebMock).not_to have_requested(:get, "http://internal.corp/secret")
      end

      it "allows a public IPv4 address" do
        stub_request(:get, "http://8.8.8.8").to_return(status: 200, body: "ok")

        expect(client.get("http://8.8.8.8").code).to eq(200)
      end

      it "allows a public IPv6 address" do
        stub_request(:get, "http://[2001:4860:4860::8888]").to_return(status: 200, body: "ok")

        expect(client.get("http://[2001:4860:4860::8888]").code).to eq(200)
      end

      it "pins the validated address onto the connection it opens" do
        connections = spy_on_connections

        client.get(url)

        expect(connections.map(&:address)).to eq(["example.com"])
        expect(connections.map(&:ipaddr)).to eq(["93.184.216.34"])
      end

      it "pins the validated address on every redirect hop" do
        allow(Resolv).to receive(:getaddresses).with("other.example").and_return(["198.51.100.7"])
        stub_request(:get, url)
          .to_return(status: 302, headers: {"Location" => "https://other.example/final"})
        stub_request(:get, "https://other.example/final").to_return(status: 200, body: "final body")
        connections = spy_on_connections

        client.get(url)

        expect(connections.map { |http| [http.address, http.ipaddr] })
          .to eq([["example.com", "93.184.216.34"], ["other.example", "198.51.100.7"]])
      end

      it "resolves a relative redirect against the current hop's host" do
        allow(Resolv).to receive(:getaddresses).with("other.example").and_return(["198.51.100.7"])
        stub_request(:get, url)
          .to_return(status: 302, headers: {"Location" => "https://other.example/b"})
        stub_request(:get, "https://other.example/b")
          .to_return(status: 302, headers: {"Location" => "/c"})
        stub_request(:get, "https://other.example/c").to_return(status: 200, body: "final body")

        expect(client.get(url).body).to eq("final body")
        expect(WebMock).to have_requested(:get, "https://other.example/c")
      end

      it "re-validates on each redirect and raises if the redirect target is a private IP" do
        stub_request(:get, "https://example.com/api")
          .to_return(status: 302, headers: {"Location" => "http://192.168.1.1/admin"})

        expect { client.get("https://example.com/api") }.to raise_error(described_class::InvalidUrlError)
        expect(WebMock).not_to have_requested(:get, "http://192.168.1.1/admin")
      end
    end
  end

  describe "#delete" do
    let(:url) { "https://example.com/api/item/1" }

    it "sends a DELETE with basic auth and the User-Agent" do
      stub_request(:delete, url).to_return(status: 200, body: "{}")

      response = client.delete(url, basic_auth: {username: "admin", password: "secret"})

      expect(response.success?).to be(true)
      expect(WebMock).to have_requested(:delete, url)
        .with(basic_auth: ["admin", "secret"], headers: {"User-Agent" => user_agent})
    end

    it "does not follow redirects" do
      stub_request(:delete, url).to_return(status: 307, headers: {"Location" => "https://elsewhere.example.com/"})

      expect(client.delete(url, basic_auth: {username: "admin", password: "secret"}).code).to eq(307)
      expect(WebMock).not_to have_requested(:delete, "https://elsewhere.example.com/")
    end
  end
end
