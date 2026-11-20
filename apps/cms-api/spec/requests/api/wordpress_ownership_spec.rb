require "rails_helper"

RSpec.describe "WordPress ownership API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "SOURCE") }

  let(:wordpress_params) do
    {
      source: {
        hub_id: hub.id,
        source_type: "wordpress_api",
        config: {site_url: "https://blog.example.com"}
      }
    }
  end

  let(:api_base) { "https://blog.example.com/wp-json/wp/v2" }
  let(:ownership_code) { SourceIngestors::WordpressOwnership.code(hub_id: hub.id, site_url: "https://blog.example.com") }

  it "returns the ownership code and where to change the tagline" do
    ingestor = instance_double(SourceIngestors::WordpressApi, application_passwords_authorization_url: nil)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)

    post "/api/sources/ownership_code", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:ok)
    json = JSON.parse(response.body)
    expect(json["code"]).to eq(ownership_code)
    expect(json["settings_url"]).to eq("https://blog.example.com/wp-admin/options-general.php")
    expect(json["authorize_url"]).to be_nil
  end

  it "returns where to approve Suwali when the site supports Application Passwords" do
    endpoint = "https://blog.example.com/wp-admin/authorize-application.php"
    ingestor = instance_double(SourceIngestors::WordpressApi, application_passwords_authorization_url: endpoint)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)

    post "/api/sources/ownership_code", params: wordpress_params, headers: headers

    authorize_url = Addressable::URI.parse(JSON.parse(response.body)["authorize_url"])
    expect(authorize_url.omit(:query).to_s).to eq(endpoint)
    state = Addressable::URI.parse(authorize_url.query_values["success_url"]).query_values["state"]
    expect(SourceIngestors::WordpressOwnership.valid_authorization_state?(state, hub_id: hub.id, site_url: "https://blog.example.com"))
      .to be(true)
  end

  it "only lets admins request an ownership code" do
    hub.hub_memberships.find_by(user: user).update!(role: :editor)

    post "/api/sources/ownership_code", params: wordpress_params, headers: headers

    expect(response).not_to have_http_status(:ok)
  end

  it "returns a receipt when the tagline contains the code" do
    ingestor = instance_double(SourceIngestors::WordpressApi, api_base: api_base)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:tagline_includes?).with(ownership_code).and_return(true)

    post "/api/sources/verify_ownership", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:ok)
    json = JSON.parse(response.body)
    expect(json["verified"]).to be(true)
    expect(SourceIngestors::WordpressOwnership.verified_api_base(json["receipt"], hub_id: hub.id, site_url: "https://blog.example.com"))
      .to eq(api_base)
  end

  it "reports when the tagline does not contain the code yet" do
    ingestor = instance_double(SourceIngestors::WordpressApi)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:tagline_includes?).and_return(false)

    post "/api/sources/verify_ownership", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:ok)
    expect(JSON.parse(response.body)).to eq("verified" => false)
  end

  it "returns a generic error when the tagline cannot be read" do
    ingestor = instance_double(SourceIngestors::WordpressApi)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:tagline_includes?).and_raise("Could not read the tagline of https://blog.example.com: status 500")

    post "/api/sources/verify_ownership", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)["error"]).to eq(I18n.t(:error_wordpress_ownership_check_failed))
  end

  it "returns a generic error and logs it as a site failure when the site fails the check" do
    ingestor = instance_double(SourceIngestors::WordpressApi)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:tagline_includes?)
      .and_raise(SourceIngestors::WordpressApi::SiteCheckFailedError, "Could not read the tagline of https://blog.example.com: status 403")
    allow(LogService).to receive(:log)

    post "/api/sources/verify_ownership", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)["error"]).to eq(I18n.t(:error_wordpress_ownership_check_failed))
    expect(LogService).to have_received(:log).with(:error, "WordpressOwnershipController", /site check: .*status 403/)
  end

  it "returns the error when the site cannot be fetched" do
    ingestor = instance_double(SourceIngestors::WordpressApi)
    allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:tagline_includes?)
      .and_raise(SourceIngestors::HttpClient::InvalidUrlError, "Could not resolve host: blog.example.com")

    post "/api/sources/verify_ownership", params: wordpress_params, headers: headers

    expect(response).to have_http_status(:unprocessable_content)
    expect(JSON.parse(response.body)["error"]).to eq("Could not resolve host: blog.example.com")
  end

  context "with an approved Application Password" do
    let(:state) do
      url = SourceIngestors::WordpressOwnership.authorize_url(
        "https://blog.example.com/wp-admin/authorize-application.php", hub_id: hub.id, site_url: "https://blog.example.com"
      )
      Addressable::URI.parse(Addressable::URI.parse(url).query_values["success_url"]).query_values["state"]
    end
    let(:ingestor) { instance_double(SourceIngestors::WordpressApi, api_base: api_base) }

    def verify_with(authorization)
      post "/api/sources/verify_ownership", params: wordpress_params.merge(authorization: authorization), headers: headers
    end

    before { allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor) }

    it "returns a receipt when the password belongs to an administrator" do
      allow(ingestor).to receive(:check_administrator).with("admin", "abcd efgh")
        .and_return(SourceIngestors::WordpressApi::AdministratorCheck.new(:verified, true))

      verify_with(state: state, user_login: "admin", password: "abcd efgh")

      json = JSON.parse(response.body)
      expect(json).to include("verified" => true, "password_revoked" => true)
      expect(SourceIngestors::WordpressOwnership.verified_api_base(json["receipt"], hub_id: hub.id, site_url: "https://blog.example.com"))
        .to eq(api_base)
    end

    it "explains why when the password does not prove ownership" do
      allow(ingestor).to receive(:check_administrator)
        .and_return(SourceIngestors::WordpressApi::AdministratorCheck.new(:not_admin, true))

      verify_with(state: state, user_login: "editor", password: "abcd efgh")

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)).to eq("verified" => false, "reason" => "not_admin", "password_revoked" => true)
    end

    it "refuses an approval made for another hub, without calling the site" do
      other_hub = create(:hub, users: [user])
      other_state = Addressable::URI.parse(Addressable::URI.parse(SourceIngestors::WordpressOwnership.authorize_url(
        "https://blog.example.com/wp-admin/authorize-application.php", hub_id: other_hub.id, site_url: "https://blog.example.com"
      )).query_values["success_url"]).query_values["state"]
      allow(ingestor).to receive(:check_administrator)

      verify_with(state: other_state, user_login: "admin", password: "abcd efgh")

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["error"]).to eq(I18n.t(:error_wordpress_authorization_invalid))
      expect(ingestor).not_to have_received(:check_administrator)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "WordPress ownership API" do
  path "/api/sources/ownership_code" do
    post "Get the code that proves ownership of a WordPress site" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      description "Returns the code an admin adds to their WordPress site's tagline before calling `verify_ownership`, " \
                  "and the settings page where the tagline is changed. When the site supports Application Passwords, also " \
                  "returns the page where its admin can approve Suwali instead; WordPress then sends them to the frontend's " \
                  "`/wordpress/authorized` page with a `state`, `user_login` and `password`. Admins only."
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              source_type: {type: :string, example: "wordpress_api", enum: ["wordpress_api"]},
              config: {type: :object, properties: {site_url: {type: :string, example: "https://blog.example.com"}}}
            },
            required: ["hub_id", "config"]
          }
        },
        required: ["source"]
      }

      response "200", "Ownership code returned" do
        schema type: :object,
          properties: {
            code: {type: :string, example: "suwali-7f3a9c2e41d0"},
            settings_url: {type: :string, example: "https://blog.example.com/wp-admin/options-general.php"},
            authorize_url: {
              type: :string, nullable: true,
              example: "https://blog.example.com/wp-admin/authorize-application.php?app_id=48517e7b-86ec-44bc-a835-2da780324652&app_name=Suwali&success_url=…",
              description: "Where the site's admin approves an Application Password for Suwali. Null when the site does not support them."
            }
          }
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, source_type: "wordpress_api", config: {site_url: "https://blog.example.com"}}} }

        before do
          ingestor = instance_double(SourceIngestors::WordpressApi, application_passwords_authorization_url: nil)
          allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
        end

        run_test! do |response|
          expect(JSON.parse(response.body)["code"]).to start_with("suwali-")
        end
      end

      response "422", "Invalid site URL" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, source_type: "wordpress_api", config: {site_url: ""}}} }

        run_test!
      end
    end
  end

  path "/api/sources/verify_ownership" do
    post "Verify ownership of a WordPress site through its tagline or an Application Password" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      description "Checks the site's tagline for the code from `ownership_code` or, when `authorization` is sent, signs in with " \
                  "the Application Password the site's admin approved, checks that it belongs to an administrator, and revokes it. " \
                  "When either proves ownership, returns a receipt, valid for one hour, to send as `source.ownership_receipt` when " \
                  "creating the source or changing its site. Admins only."
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              source_type: {type: :string, example: "wordpress_api", enum: ["wordpress_api"]},
              config: {type: :object, properties: {site_url: {type: :string, example: "https://blog.example.com"}}}
            },
            required: ["hub_id", "source_type", "config"]
          },
          authorization: {
            type: :object,
            description: "What WordPress sent back after its admin approved Suwali. Omit to check the tagline instead.",
            properties: {
              state: {type: :string, description: "From the `success_url` in `authorize_url`"},
              user_login: {type: :string, example: "admin"},
              password: {type: :string, example: "abcd EFGH 1234 ijkl MNOP 6789"}
            },
            required: ["state", "user_login", "password"]
          }
        },
        required: ["source"]
      }

      response "200", "Verification result" do
        schema type: :object,
          properties: {
            verified: {type: :boolean},
            receipt: {type: :string, description: "Present when verified"},
            reason: {
              type: :string, enum: ["not_admin", "rejected"],
              description: "With `authorization`, when not verified: the user cannot manage the site, or the site refused the password"
            },
            password_revoked: {type: :boolean, description: "With `authorization`: whether Suwali revoked the password after using it"}
          }
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, source_type: "wordpress_api", config: {site_url: "https://blog.example.com"}}} }

        before do
          ingestor = instance_double(SourceIngestors::WordpressApi, api_base: "https://blog.example.com/wp-json/wp/v2")
          allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
          allow(ingestor).to receive(:tagline_includes?).and_return(true)
        end

        run_test! do |response|
          expect(JSON.parse(response.body)["verified"]).to be(true)
        end
      end

      response "422", "Tagline could not be read" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, source_type: "wordpress_api", config: {site_url: "https://blog.example.com"}}} }

        before do
          ingestor = instance_double(SourceIngestors::WordpressApi)
          allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
          allow(ingestor).to receive(:tagline_includes?).and_raise("Could not read the tagline")
        end

        run_test!
      end
    end
  end
end
