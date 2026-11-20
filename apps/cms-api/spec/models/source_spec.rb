require "rails_helper"

RSpec.describe Source, type: :model do
  it "is valid with valid attributes" do
    source = build(:source)
    expect(source).to be_valid
  end

  it "is invalid without a name" do
    source = build(:source, name: nil)
    expect(source).not_to be_valid
  end

  it "is invalid without a type" do
    source = build(:source, source_type: nil)
    expect(source).not_to be_valid
  end

  it "is invalid with invalid type" do
    expect {
      build(:source, source_type: "book")
    }.to raise_error(ArgumentError)
  end

  it "belongs to a hub" do
    hub = create(:hub)
    source = create(:source, hub: hub)
    expect(source.hub).to eq(hub)
  end

  it "should return external URL for different source types" do
    %w[website google_drive_folder rss_feed json_api wordpress_api].each do |source_type|
      source = build(:source, source_type: source_type)
      expect(source.external_url).to be_a(String)
    end
  end

  describe "wordpress_api" do
    let(:source) { build(:source, source_type: :wordpress_api, config: {"site_url" => "https://blog.example.com", "headers" => {"X-Secret" => "abc"}}) }

    it "uses the WordPress API handler" do
      expect(source.handler).to be_a(SourceIngestors::WordpressApi)
    end

    it "uses the site URL as the external URL" do
      expect(source.external_url).to eq("https://blog.example.com")
    end

    it "only exposes the site URL in the API config" do
      expect(source.api_exposed_config).to eq({"site_url" => "https://blog.example.com"})
    end
  end

  describe "WordPress ownership" do
    let(:hub) { create(:hub) }
    let(:api_base) { "https://blog.example.com/wp-json/wp/v2" }

    def receipt_for(site_url, hub_id: hub.id, api_base: "#{site_url}/wp-json/wp/v2")
      SourceIngestors::WordpressOwnership.receipt(hub_id: hub_id, site_url: site_url, api_base: api_base)
    end

    def build_wordpress_source(**attributes)
      build(:source, hub: hub, source_type: :wordpress_api, config: {"site_url" => "https://blog.example.com"}, **attributes)
    end

    it "cannot be created without a receipt" do
      source = build_wordpress_source

      expect(source).not_to be_valid
      expect(source.errors.full_messages).to eq([I18n.t(:error_wordpress_ownership_not_verified)])
    end

    it "cannot be created with a receipt for another hub" do
      source = build_wordpress_source(ownership_receipt: receipt_for("https://blog.example.com", hub_id: create(:hub).id))

      expect(source).not_to be_valid
    end

    it "takes the API base from the receipt rather than the config" do
      source = build_wordpress_source(ownership_receipt: receipt_for("https://blog.example.com"))
      source.config = source.config.merge("api_base" => "https://evil.example.com/wp-json/wp/v2")
      source.save!

      expect(source.config["api_base"]).to eq(api_base)
      expect(source.config["ownership_verified_at"]).to be_present
    end

    context "when the source exists" do
      let!(:source) { create(:source, :wordpress_api, hub: hub) }

      it "keeps the verification when the config changes without the site" do
        source.update!(config: {"site_url" => "https://blog.example.com/", "content_type" => "pages"})

        expect(source.reload.config).to include("content_type" => "pages", "api_base" => api_base)
      end

      it "needs a new receipt when the site changes" do
        expect(source.update(config: {"site_url" => "https://other.example.com"})).to be(false)
        expect(source.errors.full_messages).to eq([I18n.t(:error_wordpress_ownership_not_verified)])
      end

      it "accepts a receipt for the new site" do
        source.update!(config: {"site_url" => "https://other.example.com"}, ownership_receipt: receipt_for("https://other.example.com"))

        expect(source.reload.config["api_base"]).to eq("https://other.example.com/wp-json/wp/v2")
      end

      it "needs a new receipt to change the API base, even for the same site" do
        expect(source.update(config: source.config.merge("api_base" => "https://blog.example.com/other/wp-json/wp/v2"))).to be(false)
        expect(source.errors.full_messages).to eq([I18n.t(:error_wordpress_ownership_not_verified)])
        expect(source.reload.config["api_base"]).to eq(api_base)
      end

      it "takes a new API base for the same site from a receipt" do
        new_base = "https://blog.example.com/?rest_route=/wp/v2"
        source.update!(ownership_receipt: receipt_for("https://blog.example.com", api_base: new_base))

        expect(source.reload.config["api_base"]).to eq(new_base)
      end
    end
  end

  it "should not create deleted documents when source is deleted" do
    source = create(:source)
    create(:document, source: source)
    expect(DeletedDocument).not_to receive(:create!)
    source.destroy!
  end

  describe "#handler" do
    it "passes the hub's crawler User-Agent to the ingestor" do
      source = create(:source, source_type: "rss_feed", config: {"feed_url" => "https://example.com/feed.xml"})
      allow(SourceIngestors::RssFeed).to receive(:new).and_call_original

      source.handler

      expect(SourceIngestors::RssFeed).to have_received(:new)
        .with(hash_including(user_agent: "Suwali/1.0 (Hub #{source.hub_id}; +https://suwali.io)"))
    end
  end

  describe "soft delete" do
    it "has a not_deleted scope" do
      active_source = create(:source)
      deleted_source = create(:source, deleted_at: Time.current)

      expect(Source.not_deleted).to include(active_source)
      expect(Source.not_deleted).not_to include(deleted_source)
    end

    it "can be created as deleted" do
      source = create(:source, deleted_at: Time.current)

      expect(source.readonly?).to be true
      expect(source.deleted?).to be true
    end

    it "is readonly when deleted" do
      source = create(:source)
      expect(source.readonly?).to be false
      expect(source.deleted?).to be false

      source.update!(deleted_at: Time.current)
      expect(source.readonly?).to be true
      expect(source.deleted?).to be true
    end

    it "prevents updates when deleted" do
      source = create(:source)
      source.update!(deleted_at: Time.current)

      expect { source.update!(name: "New Name") }.to raise_error(ActiveRecord::ReadOnlyRecord)
    end
  end

  describe "plan restrictions" do
    it "allows creating source on premium hub" do
      hub = create(:hub, plan: :enterprise)
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating source on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "allows creating first source on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating fourth source on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      3.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_max_sources_reached, max: 3))
    end
  end

  describe "plan restrictions - free_unrestricted" do
    it "allows creating unlimited sources on free_unrestricted hub" do
      hub = create(:hub, plan: :free_unrestricted)
      5.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating source on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "allows creating source on free_unrestricted hub with active trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end
  end

  describe "plan restrictions - standard" do
    it "allows creating up to 5 sources on standard hub" do
      hub = create(:hub, plan: :standard)
      4.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating sixth source on standard hub" do
      hub = create(:hub, plan: :standard)
      5.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_max_sources_reached, max: 5))
    end
  end

  describe "plan restrictions - pro" do
    it "allows creating up to 10 sources on pro hub" do
      hub = create(:hub, plan: :pro)
      9.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating eleventh source on pro hub" do
      hub = create(:hub, plan: :pro)
      10.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_max_sources_reached, max: 10))
    end
  end

  describe "plan restrictions - enterprise with custom limits" do
    it "allows creating sources up to custom limit" do
      hub = create(:hub, plan: :enterprise, custom_limits: {sources: 2})
      create(:source, hub: hub)
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end

    it "rejects creating sources over custom limit" do
      hub = create(:hub, plan: :enterprise, custom_limits: {sources: 2})
      2.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).not_to be_valid
      expect(source.errors[:base]).to include(I18n.t(:error_plan_restriction_max_sources_reached, max: 2))
    end

    it "allows unlimited sources when custom_limits not set" do
      hub = create(:hub, plan: :enterprise)
      10.times { create(:source, hub: hub) }
      source = build(:source, hub: hub)
      expect(source).to be_valid
    end
  end
end
