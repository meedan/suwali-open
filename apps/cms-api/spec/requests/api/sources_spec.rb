require "rails_helper"

RSpec.describe "Sources API", type: :request do
  let!(:user) { create(:user) }
  let(:headers) { auth_headers_for(user) }
  let!(:hub) { create(:hub, users: [user], invite_code: "SOURCE") }
  let!(:other_hub) { create(:hub, invite_code: "OTHER1") }

  let(:valid_attributes) do
    {
      source: {
        hub_id: hub.id,
        name: "Meedan Blog",
        source_type: "website",
        config: {
          title_selector: "h1#title",
          secret: "should not be returned"
        }
      }
    }
  end

  context "when getting a source" do
    let!(:source) { create(:source, hub: hub, name: "Meedan Blog") }

    it "returns the source if user has access to hub" do
      get "/api/sources/#{source.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq(source.id)
      expect(json["name"]).to eq("Meedan Blog")
    end

    it "exposes ingestion errors" do
      source.update!(last_ingestion_errors: [{"external_id" => "x", "title" => "big.pdf", "reason" => "file_too_large"}])
      get "/api/sources/#{source.id}", headers: headers
      json = JSON.parse(response.body)
      expect(json["ingestion_errors"]).to eq([{"external_id" => "x", "title" => "big.pdf", "reason" => "file_too_large"}])
    end

    it "exposes documents that failed with a non-retryable error" do
      document = create(:document, source: source, title: "scan.pdf", metadata: {drive_url: "https://drive.google.com/file/d/scan/view"})
      document.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")

      get "/api/sources/#{source.id}", headers: headers
      json = JSON.parse(response.body)

      expect(json["non_retryable_documents"]).to eq([
        {
          "id" => document.id,
          "title" => "scan.pdf",
          "external_id" => document.external_id,
          "last_sync_error_code" => "NO_TEXT_FOUND",
          "external_url" => "https://drive.google.com/file/d/scan/view"
        }
      ])
    end

    it "excludes documents with a retryable error from non-retryable documents" do
      document = create(:document, source: source)
      document.update_columns(sync_status: :error, last_sync_error_code: "SOME_TRANSIENT_FAILURE")

      get "/api/sources/#{source.id}", headers: headers
      json = JSON.parse(response.body)

      expect(json["non_retryable_documents"]).to eq([])
    end

    it "caps the number of non-retryable documents exposed" do
      stub_const("Source::NON_RETRYABLE_DOCUMENTS_LIMIT", 2)
      documents = create_list(:document, 3, source: source)
      documents.each { |document| document.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND") }

      get "/api/sources/#{source.id}", headers: headers
      json = JSON.parse(response.body)

      expect(json["non_retryable_documents"].size).to eq(2)
    end

    it "excludes documents without an error from non-retryable documents" do
      document = create(:document, source: source)
      document.update_column(:sync_status, :complete)

      get "/api/sources/#{source.id}", headers: headers
      json = JSON.parse(response.body)

      expect(json["non_retryable_documents"]).to eq([])
    end

    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      get "/api/sources/#{source.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if source doesn't exist" do
      get "/api/sources/0", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when creating a new source" do
    it "creates with valid parameters" do
      expect {
        post "/api/sources", params: valid_attributes, headers: headers
      }.to change(Source, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("Meedan Blog")
      expect(json["source_type"]).to eq("website")
    end

    it "schedules ingestion immediately after creating an active source" do
      Sidekiq::Worker.clear_all
      post "/api/sources", params: valid_attributes.deep_merge(source: {active: true}), headers: headers
      expect(response).to have_http_status(:created)
      expect(SourceIngestionWorker.jobs.size).to eq(1)
    end

    it "does not schedule ingestion when creating an inactive source" do
      Sidekiq::Worker.clear_all
      post "/api/sources", params: valid_attributes.deep_merge(source: {active: false}), headers: headers
      expect(response).to have_http_status(:created)
      expect(SourceIngestionWorker.jobs.size).to eq(0)
    end

    it "returns only public configuration parameters" do
      post "/api/sources", params: valid_attributes, headers: headers
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["config"]).to have_key("title_selector")
      expect(json["config"]).not_to have_key("secret")
    end

    it "returns validation errors if name is blank" do
      post "/api/sources", params: {source: {hub_id: hub.id, name: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json).to have_key("errors")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      post "/api/sources", params: {
        source: {
          hub_id: other_hub.id,
          name: "External Hub Source",
          source_type: "website",
          config: {base_url: "https://forbidden.org"}
        }
      }, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end

  context "when updating an existing source" do
    let!(:source) { create(:source, hub: hub, name: "Old Name") }

    it "updates the source" do
      patch "/api/sources/#{source.id}", params: {source: {name: "New Name"}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["name"]).to eq("New Name")
    end

    it "returns not found if user not in hub" do
      other_source = create(:source)
      patch "/api/sources/#{other_source.id}", params: {source: {name: "Bad Name"}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "can't update if name is blank" do
      patch "/api/sources/#{source.id}", params: {source: {name: ""}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when deleting a source" do
    it "marks source as deleted and enqueues background job" do
      source = create(:source, hub: hub)

      delete "/api/sources/#{source.id}", headers: headers

      expect(response).to have_http_status(:accepted)
      source.reload
      expect(source.deleted_at).not_to be_nil

      # Check that the worker was enqueued
      expect(DestroySourceWithDocumentsWorker.jobs.size).to eq(1)
      expect(DestroySourceWithDocumentsWorker.jobs.last["args"]).to eq([source.id])
    end

    it "returns not found if hub does not exist or user cannot access it" do
      source = create(:source)
      expect {
        delete "/api/sources/#{source.id}", headers: headers
      }.not_to change { Source.find(source.id).deleted_at }
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("Not found")
    end
  end

  context "when accessing deleted sources" do
    it "hides deleted sources from index" do
      active_source = create(:source, hub: hub, name: "Active Source")
      deleted_source = create(:source, hub: hub, name: "Deleted Source", deleted_at: Time.current)

      get "/api/hubs/#{hub.id}/sources", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)

      expect(json.map { |s| s["id"] }).to include(active_source.id)
      expect(json.map { |s| s["id"] }).not_to include(deleted_source.id)
    end

    it "returns not found when accessing a deleted source" do
      source = create(:source, hub: hub, deleted_at: Time.current)
      get "/api/sources/#{source.id}", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found when trying to update a deleted source" do
      source = create(:source, hub: hub, deleted_at: Time.current)
      patch "/api/sources/#{source.id}", params: {source: {name: "New Name"}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  context "when listing sources" do
    let!(:source) { create(:source, hub: hub, name: "Source 1") }
    let!(:other_source) { create(:source, hub: hub, name: "Source 2") }

    it "returns sources if user has access to hub" do
      get "/api/hubs/#{hub.id}/sources", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json.size).to eq(2)
      expect(json.map { |d| d["name"] }).to include("Source 1", "Source 2")
    end

    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      get "/api/hubs/#{hub.id}/sources", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "exposes each source's own non-retryable documents" do
      document = create(:document, source: source)
      document.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
      other_document = create(:document, source: other_source)
      other_document.update_columns(sync_status: :error, last_sync_error_code: "TEXT_TOO_LARGE")

      get "/api/hubs/#{hub.id}/sources", headers: headers
      json = JSON.parse(response.body)

      source_json = json.find { |s| s["id"] == source.id }
      other_source_json = json.find { |s| s["id"] == other_source.id }
      expect(source_json["non_retryable_documents"].map { |d| d["id"] }).to eq([document.id])
      expect(other_source_json["non_retryable_documents"].map { |d| d["id"] }).to eq([other_document.id])
    end
  end

  context "when creating a wordpress_api source" do
    let(:wordpress_params) do
      {
        source: {
          hub_id: hub.id,
          name: "Example Blog",
          source_type: "wordpress_api",
          active: true,
          config: {site_url: "https://blog.example.com"}
        }
      }
    end

    let(:api_base) { "https://blog.example.com/wp-json/wp/v2" }
    let(:receipt) do
      SourceIngestors::WordpressOwnership.receipt(hub_id: hub.id, site_url: "https://blog.example.com", api_base: api_base)
    end
    let(:ownership_code) { SourceIngestors::WordpressOwnership.code(hub_id: hub.id, site_url: "https://blog.example.com") }

    it "creates the source with the verified API base and schedules ingestion" do
      Sidekiq::Worker.clear_all
      expect {
        post "/api/sources", params: wordpress_params.deep_merge(source: {ownership_receipt: receipt}), headers: headers
      }.to change(hub.sources, :count).by(1)
      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["source_type"]).to eq("wordpress_api")
      expect(json["config"]).to eq({"site_url" => "https://blog.example.com"})
      expect(json["external_url"]).to eq("https://blog.example.com")
      expect(SourceIngestionWorker.jobs.size).to eq(1)

      config = hub.sources.last.config
      expect(config["api_base"]).to eq(api_base)
      expect(config["ownership_verified_at"]).to be_present
    end

    it "refuses to create the source without an ownership receipt" do
      expect {
        post "/api/sources", params: wordpress_params, headers: headers
      }.not_to change(Source, :count)
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to eq([I18n.t(:error_wordpress_ownership_not_verified)])
    end

    it "refuses a receipt issued for another site" do
      other_receipt = SourceIngestors::WordpressOwnership.receipt(hub_id: hub.id, site_url: "https://other.example.com", api_base: api_base)

      post "/api/sources", params: wordpress_params.deep_merge(source: {ownership_receipt: other_receipt}), headers: headers

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "refuses a receipt issued for another hub" do
      other_receipt = SourceIngestors::WordpressOwnership.receipt(hub_id: other_hub.id, site_url: "https://blog.example.com", api_base: api_base)

      post "/api/sources", params: wordpress_params.deep_merge(source: {ownership_receipt: other_receipt}), headers: headers

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "ignores an API base sent by the client" do
      params = wordpress_params.deep_merge(source: {ownership_receipt: receipt, config: {api_base: "https://evil.example.com/wp-json/wp/v2"}})

      post "/api/sources", params: params, headers: headers

      expect(hub.sources.last.config["api_base"]).to eq(api_base)
    end

    context "when editing an existing source" do
      let!(:source) { create(:source, :wordpress_api, hub: hub) }

      it "keeps the verification when the site stays the same" do
        verified_at = source.config["ownership_verified_at"]

        put "/api/sources/#{source.id}", params: {source: {config: {site_url: "https://blog.example.com/", content_type: "pages"}}}, headers: headers

        expect(response).to have_http_status(:ok)
        expect(source.reload.config).to include("content_type" => "pages", "api_base" => api_base, "ownership_verified_at" => verified_at)
      end

      it "requires a new receipt when the site changes" do
        put "/api/sources/#{source.id}", params: {source: {config: {site_url: "https://other.example.com"}}}, headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(source.reload.config["site_url"]).to eq("https://blog.example.com")
      end

      it "refuses an API base sent by the client without a receipt" do
        put "/api/sources/#{source.id}", params: {source: {config: {site_url: "https://blog.example.com", api_base: "https://evil.example.com/wp-json/wp/v2"}}}, headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(source.reload.config["api_base"]).to eq(api_base)
      end

      it "accepts a receipt for the new site" do
        new_receipt = SourceIngestors::WordpressOwnership.receipt(
          hub_id: hub.id, site_url: "https://other.example.com", api_base: "https://other.example.com/wp-json/wp/v2"
        )

        put "/api/sources/#{source.id}", params: {source: {config: {site_url: "https://other.example.com"}, ownership_receipt: new_receipt}}, headers: headers

        expect(response).to have_http_status(:ok)
        expect(source.reload.config["api_base"]).to eq("https://other.example.com/wp-json/wp/v2")
      end

      it "does not touch the config when only the name changes" do
        put "/api/sources/#{source.id}", params: {source: {name: "Renamed"}}, headers: headers

        expect(response).to have_http_status(:ok)
        expect(source.reload.config["api_base"]).to eq(api_base)
      end
    end

    it "previews the source with the WordPress ingestor" do
      ingestor = instance_double(SourceIngestors::WordpressApi)
      allow(SourceIngestors::WordpressApi).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_return([[
        {external_id: "1", title: "Hello world", content: "Body", metadata: {url: "https://blog.example.com/hello-world/"}, document_type: "blog_post"}
      ], 12, "Example Blog", nil, "https://blog.example.com"])

      post "/api/sources/preview", params: wordpress_params, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["documents"].first["title"]).to eq("Hello world")
      expect(json["total"]).to eq(12)
      expect(json["suggested_name"]).to eq("Example Blog")
      expect(json["suggested_url"]).to eq("https://blog.example.com")
    end
  end

  context "when creating an uploaded_files source" do
    before {
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
    }

    it "creates source with uploaded files" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("pdf content"),
        "application/pdf",
        original_filename: "report.pdf"
      )

      expect {
        post "/api/sources", params: {
          source: {
            hub_id: hub.id,
            name: "My Uploads",
            source_type: "uploaded_files",
            files: [file]
          }
        }, headers: headers
      }.to change(Source, :count).by(1)

      expect(response).to have_http_status(:created)
      json = JSON.parse(response.body)
      expect(json["source_type"]).to eq("uploaded_files")
      expect(json["documents_count"]).to eq(1)
    end

    it "returns error when no files are provided" do
      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files"
        }
      }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to include(I18n.t(:error_uploaded_files_source_type_no_files))
    end

    it "returns error when files have invalid extensions" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("image data"),
        "image/png",
        original_filename: "photo.png"
      )

      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files",
          files: [file]
        }
      }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(Source.where(source_type: :uploaded_files).count).to eq(0)
    end

    it "sets last_synced_at after uploading files" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("pdf content"),
        "application/pdf",
        original_filename: "report.pdf"
      )

      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files",
          files: [file]
        }
      }, headers: headers

      expect(response).to have_http_status(:created)
      source = Source.find(JSON.parse(response.body)["id"])
      expect(source.last_synced_at).to be_within(5.seconds).of(Time.current)
    end

    it "sets document_size after uploading files" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("pdf content"),
        "application/pdf",
        original_filename: "report.pdf"
      )

      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files",
          files: [file]
        }
      }, headers: headers

      expect(response).to have_http_status(:created)
      source = Source.find(JSON.parse(response.body)["id"])
      expect(source.documents.first.document_size).to eq("pdf content".bytesize)
    end

    it "stores the file content for uploaded markdown files" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("# Heading\n\nSome text."),
        "text/markdown",
        original_filename: "notes.md"
      )

      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files",
          files: [file]
        }
      }, headers: headers

      expect(response).to have_http_status(:created)
      source = Source.find(JSON.parse(response.body)["id"])
      expect(source.documents.first.content).to eq("# Heading\n\nSome text.")
    end

    it "does not schedule ingestion for uploaded_files sources" do
      Sidekiq::Worker.clear_all
      file = Rack::Test::UploadedFile.new(
        StringIO.new("pdf content"),
        "application/pdf",
        original_filename: "report.pdf"
      )

      post "/api/sources", params: {
        source: {
          hub_id: hub.id,
          name: "My Uploads",
          source_type: "uploaded_files",
          active: true,
          files: [file]
        }
      }, headers: headers

      expect(response).to have_http_status(:created)
      expect(SourceIngestionWorker.jobs.size).to eq(0)
    end
  end

  context "when updating an uploaded_files source" do
    before {
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
    }

    let!(:uploaded_source) { create(:source, hub: hub, source_type: :uploaded_files, config: {}, name: "My Uploads") }

    it "adds new files to the source" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("pdf content"),
        "application/pdf",
        original_filename: "new_report.pdf"
      )

      expect {
        patch "/api/sources/#{uploaded_source.id}", params: {
          source: {files: [file]}
        }, headers: headers
      }.to change(Document, :count).by(1)

      expect(response).to have_http_status(:ok)
    end

    it "returns error for invalid files on update" do
      file = Rack::Test::UploadedFile.new(
        StringIO.new("image data"),
        "image/png",
        original_filename: "photo.png"
      )

      patch "/api/sources/#{uploaded_source.id}", params: {
        source: {files: [file]}
      }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when configuring a source" do
    let(:configuration_params) do
      {
        source: {
          hub_id: hub.id,
          source_type: "rss_feed",
          config: {
            feed_url: "https://example.org/feed"
          }
        }
      }
    end

    it "returns error when configuration is requested for source of unsupported type" do
      # types google_drive_folder, json_api, uploaded_files
      json_configuration_params = {
        source: {
          hub_id: hub.id,
          source_type: "json_api",
          config: {
            base_url: "https://example.org/example_json_endpoint.json"
          }
        }
      }

      post "/api/sources/configure", params: json_configuration_params, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns configuration for the website source type" do
      allow_any_instance_of(SourceIngestors::Website).to receive(:configure).and_return({
        type: "css",
        selectors: {link: ".post-link", title: ".title", body: ".body"},
        pagination: {multi_page: true, suggested_website_url: "https://example.org/posts?page={page}"}
      })

      post "/api/sources/configure", params: {
        source: {
          hub_id: hub.id,
          source_type: "website",
          config: {base_url: "https://example.org/posts"}
        }
      }, headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["configuration"]["type"]).to eq("css")
      expect(json["configuration"]["selectors"]).to eq({"link" => ".post-link", "title" => ".title", "body" => ".body"})
      expect(json["configuration"]["pagination"]).to eq({"multi_page" => true, "suggested_website_url" => "https://example.org/posts?page={page}"})
    end

    it "returns configuration for the RSS Feed source type" do
      stub_request(:get, "https://example.org/feed")
        .to_return(status: 200, body: <<~XML)
          <?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Test Feed</title>
              <item><title>Post</title><description>Short.</description></item>
            </channel>
          </rss>
        XML

      post "/api/sources/configure", params: configuration_params, headers: headers
      expect(response).to have_http_status(:ok)
    end

    it "fetches the feed with the hub's User-Agent" do
      stub_request(:get, "https://example.org/feed")
        .to_return(status: 200, body: "<rss version=\"2.0\"><channel><title>Test Feed</title></channel></rss>")

      post "/api/sources/configure", params: configuration_params, headers: headers

      expect(WebMock).to have_requested(:get, "https://example.org/feed")
        .with(headers: {"User-Agent" => "Suwali/1.0 (Hub #{hub.id}; +https://suwali.io)"})
    end

    it "returns 413 when the feed response exceeds the maximum allowed size" do
      stub_const("SourceIngestors::FileConstraints::MAX_SIZE_BYTES", 8)
      stub_request(:get, "https://example.org/feed")
        .to_return(status: 200, body: "more than eight bytes")

      post "/api/sources/configure", params: configuration_params, headers: headers
      expect(response).to have_http_status(413)
      expect(JSON.parse(response.body)["error_code"]).to eq("content_too_large")
    end

    it "returns 422 instead of crashing when the website's listing page cannot be fetched" do
      stub_request(:get, "https://example.org/posts").to_return(status: 404)

      post "/api/sources/configure", params: {
        source: {
          hub_id: hub.id,
          source_type: "website",
          config: {base_url: "https://example.org/posts"}
        }
      }, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["error"]).to match(/Failed to fetch/)
    end
  end

  context "when previewing a source" do
    let(:preview_params) do
      {
        source: {
          hub_id: hub.id,
          name: "Test Blog",
          source_type: "website",
          config: {
            base_url: "https://example.com/page/{page}",
            post_link_selector: "a.post-link",
            title_selector: "h1.title",
            body_selector: "div.content"
          }
        }
      }
    end

    it "returns preview documents with valid parameters" do
      # Stub the ingestor to return mock documents
      ingestor = instance_double(SourceIngestors::Website)
      allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_return([[
        {
          external_id: "https://example.com/post-1",
          title: "Test Title",
          content: "Test content",
          metadata: {url: "https://example.com/post-1"},
          document_type: "blog_post"
        }
      ], 1, nil])

      post "/api/sources/preview", params: preview_params, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json).to be_a(Hash)
      expect(json["documents"]).to be_an(Array)
      expect(json["documents"].first["title"]).to eq("Test Title")
      expect(json["documents"].first["content"]).to eq("Test content")
    end

    it "includes the suggested name in the response when the ingestor returns one" do
      ingestor = instance_double(SourceIngestors::Website)
      allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_return([[], 0, "My News Blog"])

      post "/api/sources/preview", params: preview_params, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["suggested_name"]).to eq("My News Blog")
    end

    it "includes the suggested url in the response when the ingestor returns one" do
      ingestor = instance_double(SourceIngestors::Website)
      allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_return(
        SourceIngestors::IngestionResult.new(documents: [], total: 0, suggested_name: nil, suggested_url: "https://example.com/feed.xml")
      )

      post "/api/sources/preview", params: preview_params, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["suggested_url"]).to eq("https://example.com/feed.xml")
    end

    it "returns nil suggested name when the ingestor returns none" do
      ingestor = instance_double(SourceIngestors::Website)
      allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_return([[], 0, nil])

      post "/api/sources/preview", params: preview_params, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["suggested_name"]).to be_nil
    end

    it "returns error when handler raises an exception" do
      # Stub the ingestor to raise an error
      ingestor = instance_double(SourceIngestors::Website)
      allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
      allow(ingestor).to receive(:preview).and_raise(StandardError.new("Failed to fetch page"))

      post "/api/sources/preview", params: preview_params, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq("Failed to fetch page")
    end

    it "returns not found if hub doesn't exist or user can't access it" do
      unauthorized_params = {
        source: {
          hub_id: other_hub.id,
          name: "Test Blog",
          source_type: "website",
          config: {base_url: "https://example.com"}
        }
      }

      post "/api/sources/preview", params: unauthorized_params, headers: headers
      expect(response).to have_http_status(:not_found)
      json = JSON.parse(response.body)
      expect(json["error"]).to eq(I18n.t(:error_not_found))
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Sources API" do
  path "/api/sources" do
    post "Creates a source" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              name: {type: :string, example: "Meedan Blog"},
              source_type: {type: :string, example: "website", enum: Source::TYPES.keys.map(&:to_s)},
              ownership_receipt: {type: :string, description: "Required for `wordpress_api`: the receipt from `/api/sources/verify_ownership`"},
              config: {
                type: :object,
                example: {},
                description: "For `website` source type, configuration must include:\n\n" \
                             "• `base_url`: base URL with optional `{page}` placeholder.\n\n" \
                             "• `post_link_selector`, `title_selector`, `body_selector`: CSS selectors.\n\n" \
                             "For `google_drive_folder` source type, configuration must include:\n\n" \
                             "• `folder_url`: URL of a shared Google Drive folder (the folder MUST be shared with the service account email returned as `google_drive_share_email` by `GET /api/about`).\n\n" \
                             "For `wordpress_api` source type, configuration must include:\n\n" \
                             "• `site_url`: home page URL of a WordPress site with its REST API enabled.\n\n" \
                             "  Also send `source.ownership_receipt` from `/api/sources/verify_ownership`.\n\n" \
                             "For `uploaded_files` source type, no configuration is needed. Files are uploaded via multipart form data in the `source[files][]` parameter.\n"
              }
            },
            required: ["hub_id", "name", "source_type"]
          }
        },
        required: ["source"]
      }

      response "201", "Source created" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, name: "Meedan Blog", source_type: "website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:source) { {"source" => {name: "Meedan Blog", source_type: "website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to create source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, name: "Meedan Blog", source_type: "website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, name: "", source_type: "website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end

      response "422", "Uploaded files source without files" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) { {"source" => {hub_id: hub.id, name: "My Uploads", source_type: "uploaded_files"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/sources/{id}" do
    get "Gets a source" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Source ID"

      response "200", "Source found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_source) { create(:source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Source not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    patch "Updates a source" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Source ID"
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              id: {type: :integer, example: 1},
              name: {type: :string, example: "Meedan Blog"},
              active: {type: :boolean, example: true}
            },
            required: ["id"]
          }
        },
        required: ["source"]
      }

      response "200", "Source updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        let(:source) { {"source" => {name: "Meedan Website", active: true}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:source) { {} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_source) { create(:source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        let(:source) { {"source" => {name: "Meedan Website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Source not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:source) { {"source" => {name: "Meedan Website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        let(:source) { {"source" => {name: ""}} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end

    delete "Deletes a source" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Source ID"

      response "202", "Source scheduled to be deleted" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:existing_source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:existing_source) { create(:source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_source.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Source not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/hubs/{hub_id}/sources" do
    get "Lists the sources of a hub" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"

      response "200", "Lists of sources of a hub" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:hub_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/sources/configure" do
    post "Suggest configuration for a source before creation" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              source_type: {type: :string, example: "website", enum: ["rss_feed", "website"]},
              config: {
                type: :object,
                properties: {
                  base_url: {type: :string, example: "https://example.com/posts/page/2"}
                }
              }
            },
            required: ["hub_id", "source_type", "config"]
          }
        },
        required: ["source"]
      }

      response "200", "Configuration suggestion returned" do
        schema type: :object,
          properties: {
            configuration: {
              type: :object,
              properties: {
                type: {
                  type: :string,
                  nullable: true,
                  enum: ["feed", "css", nil],
                  description: "`feed` — full content available in the feed itself. `css` — use the returned CSS selector to scrape the article page. `null` — could not be determined."
                },
                selectors: {
                  type: :object,
                  description: "CSS selectors keyed by role (e.g. `body`, `link`, `title`). Empty when `type` is not `css`."
                },
                pagination: {
                  type: :object,
                  nullable: true,
                  description: "Website sources only. Absent for other source types.",
                  properties: {
                    multi_page: {
                      type: :boolean,
                      nullable: true,
                      description: "`true` if pagination was detected, `false` if detection ran cleanly and found none, `null` if detection failed unexpectedly."
                    },
                    suggested_website_url: {
                      type: :string,
                      nullable: true,
                      description: "The suggested `base_url` with a `{page}` placeholder substituted in, e.g. `https://example.com/posts?page={page}`. `null` when no pagination was detected."
                    }
                  }
                }
              }
            }
          }

        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              source_type: "rss_feed",
              config: {feed_url: "https://example.com/feed.xml"}
            }
          }
        end

        before do
          allow(SourceIngestors::RssFeed).to receive(:new).and_return(
            instance_double(SourceIngestors::RssFeed,
              configure: {type: "feed", selectors: {}})
          )
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json["configuration"]).to have_key("type")
          expect(json["configuration"]).to have_key("selectors")
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:source) { {"source" => {hub_id: 1, source_type: "rss_feed", config: {feed_url: "https://example.com/feed.xml"}}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to configure source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              source_type: "rss_feed",
              config: {feed_url: "https://example.com/feed.xml"}
            }
          }
        end
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Source type does not support configuration" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              source_type: "json_api",
              config: {base_url: "https://example.com/api.json"}
            }
          }
        end
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end

      response "413", "Source content exceeds the maximum allowed size" do
        schema type: :object,
          properties: {
            error: {type: :string},
            error_code: {type: :string, enum: ["content_too_large"]}
          }

        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              source_type: "rss_feed",
              config: {feed_url: "https://example.com/feed.xml"}
            }
          }
        end

        before do
          rss = instance_double(SourceIngestors::RssFeed)
          allow(rss).to receive(:configure).and_raise(
            SourceIngestors::HttpClient::ResponseTooLargeError,
            "Response from https://example.com/feed.xml exceeded 5242880 bytes"
          )
          allow(SourceIngestors::RssFeed).to receive(:new).and_return(rss)
        end

        run_test! do |response|
          expect(response).to have_http_status(413)
          json = JSON.parse(response.body)
          expect(json["error_code"]).to eq("content_too_large")
        end
      end
    end
  end

  path "/api/sources/preview" do
    post "Preview a source before creation" do
      tags "Source"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :source, in: :body, schema: {
        type: :object,
        properties: {
          source: {
            type: :object,
            properties: {
              hub_id: {type: :integer, example: 1},
              name: {type: :string, example: "Test Blog"},
              source_type: {type: :string, example: "website", enum: Source::TYPES.keys.map(&:to_s)},
              config: {
                type: :object,
                example: {
                  base_url: "https://example.com/page/{page}",
                  post_link_selector: "a.post-link",
                  title_selector: "h1.title",
                  body_selector: "div.content"
                },
                description: "Configuration for the source type. For `website`, same as create endpoint."
              }
            },
            required: ["hub_id", "name", "source_type", "config"]
          }
        },
        required: ["source"]
      }

      response "200", "Preview successful" do
        schema type: :object,
          properties: {
            documents: {type: :array, items: {type: :object}},
            total: {type: :integer},
            suggested_name: {type: :string, nullable: true, description: "Human-readable name extracted from the source (feed title, page title, folder name)"}
          }
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              name: "Test Blog",
              source_type: "website",
              config: {
                base_url: "https://example.com/page/{page}",
                post_link_selector: "a.post-link",
                title_selector: "h1.title",
                body_selector: "div.content"
              }
            }
          }
        end

        before do
          # Stub the ingestor to return mock documents
          ingestor = instance_double(SourceIngestors::Website)
          allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
          allow(ingestor).to receive(:preview).and_return([[
            {
              external_id: "https://example.com/post-1",
              title: "Test Title",
              content: "Test content",
              metadata: {url: "https://example.com/post-1"},
              document_type: "blog_post"
            }
          ], 1, "My News Blog"])
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
          json = JSON.parse(response.body)
          expect(json).to be_a(Hash)
          expect(json["documents"]).to be_an(Array)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:source) { {"source" => {name: "Test Blog", source_type: "website"}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - no permission to preview source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              name: "Test Blog",
              source_type: "website",
              config: {base_url: "https://example.com"}
            }
          }
        end
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Invalid source configuration" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source) do
          {
            "source" => {
              hub_id: hub.id,
              name: "Test Blog",
              source_type: "website",
              config: {
                base_url: "https://example.com"
              }
            }
          }
        end

        before do
          # Stub the ingestor to raise an error
          ingestor = instance_double(SourceIngestors::Website)
          allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
          allow(ingestor).to receive(:preview).and_raise(StandardError.new("Failed to fetch page"))
        end

        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end
end

# Separate describe block so `use_transactional_tests = false` is set at class level to give each thread its own DB connection, allowing the race condition to manifest.
RSpec.describe "Sources API - Concurrent Creation", type: :request do
  self.use_transactional_tests = false

  after { DatabaseCleaner.clean_with(:truncation) }

  it "does not allow exceeding source limit" do
    user = create(:user)
    headers = auth_headers_for(user)
    free_hub = create(:hub, users: [user], invite_code: "FREE12", plan: :free)
    create(:source, hub: free_hub, name: "Source 1")
    create(:source, hub: free_hub, name: "Source 2")
    params = {
      source: {
        hub_id: free_hub.id,
        name: "Concurrent",
        source_type: "website",
        config: {base_url: "https://concurrent.org"}
      }
    }
    threads = []
    2.times do
      threads << Thread.new do
        post "/api/sources", params: params, headers: headers
      end
    end
    threads.each(&:join)
    expect(free_hub.sources.count).to eq(3)
  end
end
