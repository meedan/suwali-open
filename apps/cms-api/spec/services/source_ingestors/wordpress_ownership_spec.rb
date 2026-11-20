require "rails_helper"

RSpec.describe SourceIngestors::WordpressOwnership, type: :service do
  let(:site_url) { "https://blog.example.com" }
  let(:api_base) { "#{site_url}/wp-json/wp/v2" }

  describe ".code" do
    it "is stable for the same hub and site, however the URL is written" do
      code = described_class.code(hub_id: 1, site_url: site_url)

      expect(code).to match(/\Asuwali-[0-9a-f]{12}\z/)
      expect(described_class.code(hub_id: "1", site_url: "https://Blog.example.com/wp-json/")).to eq(code)
    end

    it "differs between hubs and between sites" do
      code = described_class.code(hub_id: 1, site_url: site_url)

      expect(described_class.code(hub_id: 2, site_url: site_url)).not_to eq(code)
      expect(described_class.code(hub_id: 1, site_url: "https://other.example.com")).not_to eq(code)
    end

    it "is nil without a usable site URL" do
      expect(described_class.code(hub_id: 1, site_url: "")).to be_nil
      expect(described_class.code(hub_id: 1, site_url: "not a url")).to be_nil
      expect(described_class.code(hub_id: 1, site_url: "https://:.^:")).to be_nil
    end
  end

  describe ".settings_url" do
    it "points self-hosted sites at their general settings" do
      expect(described_class.settings_url("#{site_url}/")).to eq("#{site_url}/wp-admin/options-general.php")
    end

    it "points WordPress.com sites at the WordPress.com settings page" do
      expect(described_class.settings_url("https://news.wordpress.com")).to eq("https://wordpress.com/settings/general/news.wordpress.com")
    end
  end

  describe ".verified_api_base" do
    let(:receipt) { described_class.receipt(hub_id: 1, site_url: site_url, api_base: api_base) }

    it "returns the API base from a valid receipt" do
      expect(described_class.verified_api_base(receipt, hub_id: 1, site_url: "#{site_url}/")).to eq(api_base)
    end

    it "rejects a receipt for another hub or site" do
      expect(described_class.verified_api_base(receipt, hub_id: 2, site_url: site_url)).to be_nil
      expect(described_class.verified_api_base(receipt, hub_id: 1, site_url: "https://other.example.com")).to be_nil
    end

    it "rejects an expired receipt" do
      receipt

      travel_to((described_class::RECEIPT_TTL + 1.minute).from_now) do
        expect(described_class.verified_api_base(receipt, hub_id: 1, site_url: site_url)).to be_nil
      end
    end

    it "rejects a missing or tampered receipt" do
      expect(described_class.verified_api_base(nil, hub_id: 1, site_url: site_url)).to be_nil
      expect(described_class.verified_api_base("#{receipt}x", hub_id: 1, site_url: site_url)).to be_nil
    end
  end

  describe ".authorize_url" do
    let(:endpoint) { "#{site_url}/wp-admin/authorize-application.php" }

    it "asks the site to approve Suwali and send the admin back with a state for this hub and site" do
      url = Addressable::URI.parse(described_class.authorize_url(endpoint, hub_id: 1, site_url: site_url))

      expect(url.omit(:query).to_s).to eq(endpoint)
      expect(url.query_values).to include("app_name" => "Suwali", "app_id" => described_class::APP_ID)

      success_url = Addressable::URI.parse(url.query_values["success_url"])
      expect(success_url.path).to eq(described_class::AUTHORIZED_PATH)
      state = success_url.query_values["state"]
      expect(described_class.valid_authorization_state?(state, hub_id: 1, site_url: "#{site_url}/")).to be(true)
    end

    it "uses an app ID WordPress accepts" do
      expect(described_class::APP_ID).to match(SourceIngestors::WordpressApi::UUID_FORMAT)
    end
  end

  describe ".valid_authorization_state?" do
    let(:state) do
      url = Addressable::URI.parse(described_class.authorize_url("#{site_url}/wp-admin/authorize-application.php", hub_id: 1, site_url: site_url))
      Addressable::URI.parse(url.query_values["success_url"]).query_values["state"]
    end

    it "rejects a state for another hub or site" do
      expect(described_class.valid_authorization_state?(state, hub_id: 2, site_url: site_url)).to be(false)
      expect(described_class.valid_authorization_state?(state, hub_id: 1, site_url: "https://other.example.com")).to be(false)
    end

    it "rejects an expired, missing, or tampered state" do
      state

      travel_to((described_class::AUTHORIZATION_TTL + 1.minute).from_now) do
        expect(described_class.valid_authorization_state?(state, hub_id: 1, site_url: site_url)).to be(false)
      end
      expect(described_class.valid_authorization_state?(nil, hub_id: 1, site_url: site_url)).to be(false)
      expect(described_class.valid_authorization_state?("#{state}x", hub_id: 1, site_url: site_url)).to be(false)
    end

    it "is not accepted as an ownership receipt" do
      expect(described_class.verified_api_base(state, hub_id: 1, site_url: site_url)).to be_nil
    end
  end

  describe ".verified_config" do
    let(:receipt) { described_class.receipt(hub_id: 1, site_url: site_url, api_base: api_base) }
    let(:previous) { {"site_url" => site_url, "api_base" => api_base, "ownership_verified_at" => "2026-01-01T00:00:00Z"} }

    it "takes the API base from a valid receipt rather than the config" do
      config = {"site_url" => site_url, "api_base" => "https://evil.example.com/wp-json/wp/v2"}

      verified = described_class.verified_config(config, previous: nil, receipt: receipt, hub_id: 1)

      expect(verified).to include("site_url" => site_url, "api_base" => api_base)
      expect(verified["ownership_verified_at"]).to be_present
    end

    it "is nil for a new source without a receipt" do
      expect(described_class.verified_config({"site_url" => site_url}, previous: nil, receipt: nil, hub_id: 1)).to be_nil
    end

    it "is nil for a receipt issued to another hub or site" do
      expect(described_class.verified_config({"site_url" => site_url}, previous: nil, receipt: receipt, hub_id: 2)).to be_nil
      expect(described_class.verified_config({"site_url" => "https://other.example.com"}, previous: nil, receipt: receipt, hub_id: 1)).to be_nil
    end

    it "keeps the previous verification when the site is unchanged" do
      config = {"site_url" => "#{site_url}/", "content_type" => "pages"}

      verified = described_class.verified_config(config, previous: previous, receipt: nil, hub_id: 1)

      expect(verified).to eq(previous.merge(config))
    end

    it "is nil when the API base changes without a receipt, even for the same site" do
      config = previous.merge("api_base" => "#{site_url}/other/wp-json/wp/v2")

      expect(described_class.verified_config(config, previous: previous, receipt: nil, hub_id: 1)).to be_nil
    end

    it "is nil when the site changes without a receipt" do
      expect(described_class.verified_config({"site_url" => "https://other.example.com"}, previous: previous, receipt: nil, hub_id: 1)).to be_nil
    end
  end
end
