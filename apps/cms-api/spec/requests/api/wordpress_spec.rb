require "rails_helper"

RSpec.describe "WordPress API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "SOURCE") }
  let!(:other_hub) { create(:hub, invite_code: "OTHER1") }

  context "when detecting a WordPress site" do
    it "returns the address of the WordPress site, fetched with the hub's User-Agent" do
      allow(SourceIngestors::WordpressApi).to receive(:detect_site_url).and_return("https://blog.example.com")

      post "/api/sources/detect_wordpress", params: {hub_id: hub.id, url: "https://blog.example.com/feed"}, headers: headers

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("site_url" => "https://blog.example.com")
      expect(SourceIngestors::WordpressApi).to have_received(:detect_site_url)
        .with("https://blog.example.com/feed", user_agent: "Suwali/1.0 (Hub #{hub.id}; +https://suwali.io)")
    end

    it "returns a null site_url when the URL is not a WordPress site" do
      allow(SourceIngestors::WordpressApi).to receive(:detect_site_url).and_return(nil)

      post "/api/sources/detect_wordpress", params: {hub_id: hub.id, url: "https://example.org"}, headers: headers

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("site_url" => nil)
    end

    it "only lets admins detect a WordPress site" do
      hub.hub_memberships.find_by(user: user).update!(role: :editor)
      allow(SourceIngestors::WordpressApi).to receive(:detect_site_url)

      post "/api/sources/detect_wordpress", params: {hub_id: hub.id, url: "https://example.org"}, headers: headers

      expect(response).to have_http_status(:forbidden)
      expect(SourceIngestors::WordpressApi).not_to have_received(:detect_site_url)
    end

    it "returns not found for a hub the user does not belong to" do
      allow(SourceIngestors::WordpressApi).to receive(:detect_site_url)

      post "/api/sources/detect_wordpress", params: {hub_id: other_hub.id, url: "https://example.org"}, headers: headers

      expect(response).to have_http_status(:not_found)
      expect(SourceIngestors::WordpressApi).not_to have_received(:detect_site_url)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "WordPress API" do
  path "/api/sources/detect_wordpress" do
    post "Detect whether a URL belongs to a WordPress site" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :detection, in: :body, schema: {
        type: :object,
        properties: {
          hub_id: {type: :integer, example: 1},
          url: {type: :string, example: "https://www.your-site.com/feed"}
        },
        required: ["hub_id", "url"]
      }

      response "200", "Detection result returned" do
        schema type: :object,
          properties: {
            site_url: {
              type: :string,
              nullable: true,
              description: "The address to connect with the WordPress wizard, e.g. `https://www.your-site.com`. `null` when the URL is not part of a WordPress site that advertises its REST API."
            }
          }

        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:detection) { {hub_id: hub.id, url: "https://www.your-site.com/feed"} }

        before do
          allow(SourceIngestors::WordpressApi).to receive(:detect_site_url).and_return("https://www.your-site.com")
        end

        run_test! do |response|
          expect(JSON.parse(response.body)).to eq("site_url" => "https://www.your-site.com")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:detection) { {hub_id: 1, url: "https://www.your-site.com"} }
        run_test!
      end

      response "403", "Forbidden - only hub admins can detect a WordPress site" do
        let!(:user) { create(:user) }
        # The first member is always made admin, so the editor joins after one
        let!(:hub) { create(:hub, users: [create(:user)]) }
        let(:Authorization) do
          create(:hub_membership, user: user, hub: hub, role: :editor)
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:detection) { {hub_id: hub.id, url: "https://www.your-site.com"} }
        run_test!
      end

      response "404", "Not found - no access to the hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:detection) { {hub_id: hub.id, url: "https://www.your-site.com"} }
        run_test!
      end
    end
  end
end
