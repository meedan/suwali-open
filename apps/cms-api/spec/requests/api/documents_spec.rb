require "rails_helper"

RSpec.describe "Documents API", type: :request do
  let!(:user) { create(:user) }
  let!(:hub) { create(:hub, users: [user]) }
  let!(:source) { create(:source, hub: hub) }
  let!(:document1) { create(:document, source: source, title: "Doc 1") }
  let!(:document2) { create(:document, source: source, title: "Doc 2") }
  let(:headers) { auth_headers_for(user) }

  context "when getting a document" do
    it "returns the document if user has access to hub" do
      get "/api/documents/#{document1.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["id"]).to eq(document1.id)
      expect(json["title"]).to eq("Doc 1")
    end

    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      get "/api/documents/#{document1.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if document doesn't exist" do
      get "/api/documents/0", headers: headers
      expect(response).to have_http_status(:not_found)
    end
  end

  it "returns documents for the source" do
    get "/api/sources/#{source.id}/documents", headers: headers
    expect(response).to have_http_status(:ok)
    json = JSON.parse(response.body)
    expect(json["data"].size).to eq(2)
    expect(json["data"].map { |d| d["title"] }).to include("Doc 1", "Doc 2")
    expect(json["pagination"]).to be_present
    expect(json["pagination"]["total_count"]).to eq(2)
  end

  it "returns not found if user is not part of the hub" do
    other_user = create(:user, email: Faker::Internet.email)
    other_headers = auth_headers_for(other_user)
    get "/api/sources/#{source.id}/documents", headers: other_headers
    expect(response).to have_http_status(:not_found)
  end

  it "returns error if source doesn't exist" do
    get "/api/sources/0/documents", headers: headers
    expect(response).to have_http_status(:not_found)
  end

  it "supports filter and sort options" do
    ["today", "yesterday", "last_7_days", "last_30_days", "last_90_days", "more_than_90"].each do |range|
      get "/api/sources/#{source.id}/documents", params: {
        status: "active",
        date_modified: range,
        notebooks: "true",
        sync_status: "complete,pending",
        sort_by: "created_at",
        sort_direction: "desc"
      }, headers: headers
      expect(response).to have_http_status(:ok)
    end

    # Test sync_status sorting
    get "/api/sources/#{source.id}/documents", params: {
      sort_by: "sync_status",
      sort_direction: "asc"
    }, headers: headers
    expect(response).to have_http_status(:ok)
  end

  context "when filtering by date_published" do
    let!(:recent_document) { create(:document, source: source, title: "Recent", published_at: 2.days.ago) }
    let!(:old_document) { create(:document, source: source, title: "Old", published_at: 120.days.ago) }

    it "returns only documents published within the range, excluding undated ones" do
      get "/api/sources/#{source.id}/documents", params: {date_published: "last_7_days"}, headers: headers

      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Recent"])
    end

    it "excludes undated documents from the more_than_90 range" do
      get "/api/sources/#{source.id}/documents", params: {date_published: "more_than_90"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Old"])
    end

    it "returns every document when the filter is any" do
      get "/api/sources/#{source.id}/documents", params: {date_published: "any"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to match_array(["Doc 1", "Doc 2", "Recent", "Old"])
    end
  end

  context "when sorting by published_at" do
    let!(:dated_source) { create(:source, hub: hub) }
    let!(:published_20_days_ago) { create(:document, source: dated_source, title: "Published 20 days ago", published_at: 20.days.ago, updated_at: 1.day.ago) }
    let!(:published_10_days_ago) { create(:document, source: dated_source, title: "Published 10 days ago", published_at: 10.days.ago, updated_at: 1.day.ago) }
    let!(:undated_updated_15_days_ago) { create(:document, source: dated_source, title: "Undated, updated 15 days ago", published_at: nil, updated_at: 15.days.ago) }
    let!(:undated_updated_30_days_ago) { create(:document, source: dated_source, title: "Undated, updated 30 days ago", published_at: nil, updated_at: 30.days.ago) }

    it "sorts ascending by published_at, then undated documents by updated_at" do
      get "/api/sources/#{dated_source.id}/documents", params: {sort_by: "published_at", sort_direction: "asc"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Published 20 days ago", "Published 10 days ago", "Undated, updated 30 days ago", "Undated, updated 15 days ago"])
    end

    it "sorts descending by published_at, then undated documents by updated_at" do
      get "/api/sources/#{dated_source.id}/documents", params: {sort_by: "published_at", sort_direction: "desc"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Published 10 days ago", "Published 20 days ago", "Undated, updated 15 days ago", "Undated, updated 30 days ago"])
    end

    it "orders the window around an undated document the same way" do
      get "/api/sources/#{dated_source.id}/documents", params: {sort_by: "published_at", sort_direction: "asc", around_id: undated_updated_30_days_ago.id, window_size: 2}, headers: headers

      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["data"].map { |d| d["title"] }).to eq(["Published 10 days ago", "Undated, updated 30 days ago", "Undated, updated 15 days ago"])
      expect(json["pagination"]).to include("target_record_id" => undated_updated_30_days_ago.id, "target_position" => 2, "has_previous" => true, "has_next" => false, "total_count" => 4)
    end
  end

  context "when no document has a published_at" do
    let!(:undated_source) { create(:source, hub: hub) }

    def create_undated_documents
      shared_timestamp = 3.days.ago
      create(:document, source: undated_source, title: "Oldest", published_at: nil, updated_at: 9.days.ago)
      create(:document, source: undated_source, title: "Tie A", published_at: nil, updated_at: shared_timestamp)
      create(:document, source: undated_source, title: "Tie B", published_at: nil, updated_at: shared_timestamp)
      create(:document, source: undated_source, title: "Newest", published_at: nil, updated_at: 1.day.ago)
    end

    it "sorts ascending by updated_at, then id" do
      create_undated_documents

      get "/api/sources/#{undated_source.id}/documents", params: {sort_by: "published_at", sort_direction: "asc"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Oldest", "Tie A", "Tie B", "Newest"])
    end

    it "sorts descending by updated_at, then id" do
      create_undated_documents

      get "/api/sources/#{undated_source.id}/documents", params: {sort_by: "published_at", sort_direction: "desc"}, headers: headers

      expect(JSON.parse(response.body)["data"].map { |d| d["title"] }).to eq(["Newest", "Tie B", "Tie A", "Oldest"])
    end
  end

  it "returns no documents when the sync_status filter maps to no real statuses" do
    # Selecting only the "unsupported" pseudo-status (no real document statuses) must match nothing,
    # not fall back to returning everything.
    get "/api/sources/#{source.id}/documents", params: {sync_status: "unsupported"}, headers: headers
    expect(response).to have_http_status(:ok)
    json = JSON.parse(response.body)
    expect(json["data"]).to be_empty
  end

  it "ignores the unsupported pseudo-status while still filtering by real statuses" do
    document1.update_column(:sync_status, :complete)
    document2.update_column(:sync_status, :error)

    get "/api/sources/#{source.id}/documents", params: {sync_status: "complete,unsupported"}, headers: headers
    expect(response).to have_http_status(:ok)
    json = JSON.parse(response.body)
    expect(json["data"].map { |d| d["id"] }).to contain_exactly(document1.id)
  end

  it "excludes documents with a non-retryable sync error from the default list" do
    document1.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")

    get "/api/sources/#{source.id}/documents", headers: headers
    json = JSON.parse(response.body)

    expect(json["data"].map { |d| d["id"] }).to contain_exactly(document2.id)
  end

  it "excludes documents with a non-retryable sync error even when explicitly filtering by error status" do
    document1.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
    document2.update_column(:sync_status, :error)

    get "/api/sources/#{source.id}/documents", params: {sync_status: "error"}, headers: headers
    json = JSON.parse(response.body)

    expect(json["data"].map { |d| d["id"] }).to contain_exactly(document2.id)
  end

  context "when updating a document" do
    it "updates the priority_tier" do
      patch "/api/documents/#{document1.id}", params: {document: {priority_tier: 2}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["priority_tier"]).to eq(2)
      expect(document1.reload.priority_tier).to eq(2)
    end

    it "updates the summary without touching the AI summary" do
      document1.update_column(:ai_summary, "AI summary")
      patch "/api/documents/#{document1.id}", params: {document: {summary: "User summary"}}, headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["summary"]).to eq("User summary")
      expect(document1.reload.summary).to eq("User summary")
      expect(document1.ai_summary).to eq("AI summary")
    end

    it "updates the public_url" do
      patch "/api/documents/#{document1.id}", params: {document: {public_url: "https://example.com/page"}}, headers: headers
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["public_url"]).to eq("https://example.com/page")
      expect(document1.reload.public_url).to eq("https://example.com/page")
    end

    it "clears the public_url" do
      document1.update!(public_url: "https://example.com/page")
      patch "/api/documents/#{document1.id}", params: {document: {public_url: ""}}, headers: headers
      expect(response).to have_http_status(:ok)
      expect(document1.reload.public_url).to be_nil
    end

    it "refuses a public_url that is not an http(s) URL" do
      patch "/api/documents/#{document1.id}", params: {document: {public_url: "not a url"}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      expect(JSON.parse(response.body)["errors"]).to be_present
      expect(document1.reload.public_url).to be_nil
    end

    it "updates the active status" do
      patch "/api/documents/#{document1.id}", params: {document: {active: false}}, headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["active"]).to eq(false)
      expect(document1.reload.active).to eq(false)
    end

    it "enqueues KnowledgeServiceWorker when active changes to false" do
      document1.update(active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document1.id, hub.id)
      patch "/api/documents/#{document1.id}", params: {document: {active: false}}, headers: headers
    end

    it "enqueues KnowledgeServiceWorker when active changes to true" do
      document1.update(active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", document1.id)
      patch "/api/documents/#{document1.id}", params: {document: {active: true}}, headers: headers
    end

    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      patch "/api/documents/#{document1.id}", params: {document: {active: false}}, headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns error if document doesn't exist" do
      patch "/api/documents/0", params: {document: {active: false}}, headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns error if update fails" do
      allow_any_instance_of(Document).to receive(:update).and_return(false)
      allow_any_instance_of(Document).to receive(:errors).and_return(
        double(full_messages: ["Update failed"])
      )
      patch "/api/documents/#{document1.id}", params: {document: {active: false}}, headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["errors"]).to eq(["Update failed"])
    end
  end

  context "when deleting documents" do
    let!(:other_user) { create(:user, email: Faker::Internet.email) }
    let!(:other_hub) { create(:hub, users: [other_user]) }
    let!(:other_source) { create(:source, hub: other_hub) }
    let!(:other_document) { create(:document, source: other_source, title: "Other hub document") }

    it "deletes document if user has access to hub" do
      delete "/api/documents/#{document1.id}", headers: headers
      expect(response).to have_http_status(:ok)
      json = JSON.parse(response.body)
      expect(json["message"]).to be_present
      expect(Document.exists?(document1.id)).to be_falsey
    end

    it "returns not found if user is not part of the hub" do
      another_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(another_user)
      delete "/api/documents/#{document1.id}", headers: other_headers
      expect(response).to have_http_status(:not_found)
      expect(Document.exists?(document1.id)).to be_truthy
    end

    it "returns not found for document from other hub" do
      delete "/api/documents/#{other_document.id}", headers: headers
      expect(response).to have_http_status(:not_found)
      expect(Document.exists?(other_document.id)).to be_truthy
    end
  end

  context "when retrying sync" do
    before do
      require "webmock/rspec"
      WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      document1.file.attach(
        io: File.open(Rails.root.join("spec", "files", "document.pdf")),
        filename: "document.pdf",
        content_type: "application/pdf"
      )
    end

    it "retries ingestion for error status document (active)" do
      document1.update_columns(sync_status: :error, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", document1.id)
      post "/api/documents/#{document1.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(document1.reload.sync_status).to eq("pending")
    end

    it "retries deletion for error status document (inactive)" do
      document1.update_columns(sync_status: :error, active: false)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "delete_document", document1.id, hub.id)
      post "/api/documents/#{document1.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(document1.reload.sync_status).to eq("pending")
    end

    it "retries for pending status document" do
      document1.update_columns(sync_status: :pending, active: true)
      expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", document1.id)
      post "/api/documents/#{document1.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:accepted)
      expect(document1.reload.sync_status).to eq("pending")
    end

    it "returns error for complete status document" do
      document1.update_column(:sync_status, :complete)
      post "/api/documents/#{document1.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns error for error status document with a non-retryable error code" do
      document1.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
      expect(KnowledgeServiceWorker).not_to receive(:perform_in)
      post "/api/documents/#{document1.id}/retry-sync", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns not found if user is not part of the hub" do
      document1.update_column(:sync_status, :error)
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      post "/api/documents/#{document1.id}/retry-sync", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if document doesn't exist" do
      post "/api/documents/0/retry-sync", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    context "when the document's file is missing" do
      let!(:rss_source) { create(:source, hub: hub, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"}) }
      let!(:rss_document) {
        create(:document, source: rss_source, document_type: "rss_entry", title: "My Title", content: "My Content", sync_status: :error, active: true)
      }

      before do
        require "webmock/rspec"
        WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
      end

      it "reattaches a missing file and retries ingestion for a public source type" do
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", rss_document.id)
        post "/api/documents/#{rss_document.id}/retry-sync", headers: headers

        expect(response).to have_http_status(:accepted)
        expect(rss_document.reload.file).to be_attached
        expect(rss_document.sync_status).to eq("pending")
      end

      it "reattaches a broken file (attached but missing from storage) and retries ingestion" do
        rss_document.attach_file!(Tempfile.new(["old_", ".txt"]).tap { |f|
          f.write("old content")
          f.rewind
        }.path)
        rss_document.reload
        rss_document.file.blob.service.delete(rss_document.file.blob.key)

        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", rss_document.id)
        post "/api/documents/#{rss_document.id}/retry-sync", headers: headers

        expect(response).to have_http_status(:accepted)
        expect(rss_document.reload.sync_status).to eq("pending")
      end

      it "does not reattach when the file is already fine" do
        rss_document.attach_file!(Tempfile.new(["existing_", ".txt"]).tap { |f|
          f.write("existing content")
          f.rewind
        }.path)

        expect(rss_document.source).not_to receive(:handler)
        expect(KnowledgeServiceWorker).to receive(:perform_in).with(30.seconds, "ingest_document", rss_document.id)
        post "/api/documents/#{rss_document.id}/retry-sync", headers: headers

        expect(response).to have_http_status(:accepted)
      end

      it "does not retry ingestion when the file remains missing for a non-public source type" do
        pdf_document = create(:document, source: source, document_type: "pdf", active: true)
        pdf_document.update_column(:sync_status, :error)

        expect(KnowledgeServiceWorker).not_to receive(:perform_in)
        post "/api/documents/#{pdf_document.id}/retry-sync", headers: headers

        expect(response).to have_http_status(:unprocessable_content)
        expect(pdf_document.reload.sync_status).to eq("error")
      end
    end
  end

  context "when refreshing a document" do
    it "returns not found if user is not part of the hub" do
      other_user = create(:user, email: Faker::Internet.email)
      other_headers = auth_headers_for(other_user)
      post "/api/documents/#{document1.id}/refresh", headers: other_headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if document doesn't exist" do
      post "/api/documents/0/refresh", headers: headers
      expect(response).to have_http_status(:not_found)
    end

    it "returns error for pending status document" do
      post "/api/documents/#{document1.id}/refresh", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns error for error status document" do
      document1.update_column(:sync_status, :error)
      post "/api/documents/#{document1.id}/refresh", headers: headers
      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "returns error when the source type doesn't support refresh" do
      rss_source = create(:source, hub: hub, source_type: "rss_feed", config: {feed_url: "http://example.com/feed"})
      rss_document = create(:document, source: rss_source, document_type: "rss_entry", active: false)

      post "/api/documents/#{rss_document.id}/refresh", headers: headers

      expect(response).to have_http_status(:unprocessable_content)
      json = JSON.parse(response.body)
      expect(json["error"]).to be_present
    end

    it "queues a background refresh when the handler supports it" do
      website_source = create(:source, hub: hub, source_type: "website", config: {base_url: "https://example.com"})
      website_document = create(:document, source: website_source, document_type: "blog_post")
      website_document.update_column(:sync_status, :complete)

      expect(DocumentRefreshWorker).to receive(:perform_async).with(website_document.id)

      post "/api/documents/#{website_document.id}/refresh", headers: headers

      expect(response).to have_http_status(:accepted)
      expect(website_document.reload.sync_status).to eq("complete")
    end
  end

  context "when filtering by topics" do
    let!(:climate) { create(:topic, hub: hub, name: "Climate") }
    let!(:housing) { create(:topic, hub: hub, name: "Housing") }
    let!(:climate_document) { create(:document, source: source, title: "About climate").tap { |doc| create(:topic_item, topic: climate, item: doc) } }
    let!(:housing_document) { create(:document, source: source, title: "About housing").tap { |doc| create(:topic_item, topic: housing, item: doc) } }
    let!(:both_document) do
      create(:document, source: source, title: "About both").tap do |doc|
        create(:topic_item, topic: climate, item: doc)
        create(:topic_item, topic: housing, item: doc)
      end
    end

    def titles_for(params)
      get "/api/sources/#{source.id}/documents", params: params, headers: headers
      expect(response).to have_http_status(:ok)
      JSON.parse(response.body)["data"].map { |d| d["title"] }
    end

    it "returns the documents that have the topic" do
      expect(titles_for(topics: climate.id.to_s)).to match_array(["About climate", "About both"])
    end

    it "returns the documents that have any of the topics, each once" do
      expect(titles_for(topics: "#{climate.id},#{housing.id}")).to match_array(["About climate", "About housing", "About both"])
      expect(JSON.parse(response.body)["pagination"]["total_count"]).to eq(3)
    end

    it "returns all but the documents that have the topic, when excluding" do
      expect(titles_for(topics: climate.id.to_s, topics_mode: "exclude")).to match_array(["Doc 1", "Doc 2", "About housing"])
    end

    it "returns the documents that have none of the topics, when excluding several" do
      expect(titles_for(topics: "#{climate.id},#{housing.id}", topics_mode: "exclude")).to match_array(["Doc 1", "Doc 2"])
    end

    it "returns the documents with no topics for none" do
      expect(titles_for(topics: "none")).to match_array(["Doc 1", "Doc 2"])
    end

    it "returns the documents with any topic when excluding none" do
      expect(titles_for(topics: "none", topics_mode: "exclude")).to match_array(["About climate", "About housing", "About both"])
    end

    it "returns the documents that have the topic or have none, for both chosen" do
      expect(titles_for(topics: "#{climate.id},none")).to match_array(["Doc 1", "Doc 2", "About climate", "About both"])
    end

    it "returns the documents that have neither the topic nor none, when excluding both" do
      expect(titles_for(topics: "#{climate.id},none", topics_mode: "exclude")).to match_array(["About housing"])
    end

    it "filters nothing when no topic is chosen, or what is chosen is not a topic" do
      everything = ["Doc 1", "Doc 2", "About climate", "About housing", "About both"]

      expect(titles_for(topics: "")).to match_array(everything)
      expect(titles_for(topics: "any")).to match_array(everything)
      expect(titles_for(topics: "abc, ,")).to match_array(everything)
    end

    it "treats a mode it does not know as including" do
      expect(titles_for(topics: housing.id.to_s, topics_mode: "sideways")).to match_array(["About housing", "About both"])
    end

    it "matches no document for a topic of another hub, and excludes none" do
      other_topic = create(:topic, name: "Climate")

      expect(titles_for(topics: other_topic.id.to_s)).to be_empty
      expect(titles_for(topics: other_topic.id.to_s, topics_mode: "exclude").size).to eq(5)
    end

    it "keeps the order of the documents it returns" do
      expect(titles_for(topics: "#{climate.id},#{housing.id}", sort_by: "title", sort_direction: "asc")).to eq(["About both", "About climate", "About housing"])
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Documents API" do
  path "/api/sources/{source_id}/documents" do
    get "Lists the documents of a source" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :source_id, in: :path, type: :string, description: "Source ID"
      parameter name: :topics, in: :query, type: :string, required: false, description: "Topic ids, separated by commas, and \"none\" for the items with no topics. Shows the items that have any of them, or all but those with topics_mode exclude"
      parameter name: :topics_mode, in: :query, type: :string, required: false, enum: %w[include exclude], description: "Whether the topics filter shows the matching items (the default) or all but them"

      response "200", "Lists of documents of a source" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source_id) { source.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:source_id) { 1 }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:source_id) { source.id }
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
        let(:source_id) { 0 }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/documents/{id}" do
    get "Gets a document" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Document ID"

      response "200", "Document found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:existing_document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_document.id }
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
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:existing_document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_document.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Document not found" do
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

    patch "Updates a document" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Document ID"
      parameter name: :document, in: :body, schema: {
        type: :object,
        properties: {
          document: {
            type: :object,
            properties: {
              active: {type: :boolean, example: false},
              priority_tier: {
                type: :integer,
                example: 1,
                description: "Priority tier: -1 (low, preloaded FAQ), 1 (default), 2 (high)"
              },
              summary: {
                type: :string,
                maxLength: 2000,
                example: "A summary written by a user",
                description: "Summary written by a user, which takes precedence over the AI-generated one (ai_summary)"
              },
              public_url: {
                type: :string,
                nullable: true,
                maxLength: 1000,
                example: "https://example.com/article",
                description: "http(s) URL shown to end users under \"Show more\"; blank clears it"
              }
            }
          }
        },
        required: ["document"]
      }

      response "200", "Document updated" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:existing_document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_document.id }
        let(:document) { {"document" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:id) { 1 }
        let(:document) { {"document" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:existing_document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { existing_document.id }
        let(:document) { {"document" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Document not found" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { 0 }
        let(:document) { {"document" => {active: false}} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end

    delete "Deletes a document" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Document ID"

      response "200", "Document deleted successfully" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) { create(:document, source: source) }
        let(:Authorization) { nil }
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) { create(:document, source: source) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end

  path "/api/documents/{id}/retry-sync" do
    post "Retries sync for a document" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Document ID"

      response "202", "Sync retry queued" do
        before do
          require "webmock/rspec"
          WebMock.disable_net_connect!(allow: [/silo/, /localhost/])
        end

        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, :with_pdf, source: source)
          doc.update_column(:sync_status, :error)
          doc
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, source: source)
          doc.update_column(:sync_status, :error)
          doc
        end
        let(:Authorization) { nil }
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, source: source)
          doc.update_column(:sync_status, :error)
          doc
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "404", "Document not found" do
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

      response "422", "Document not in retryable state" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, source: source)
          doc.update_column(:sync_status, :complete)
          doc
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/documents/{id}/refresh" do
    post "Refreshes a document's content from its source" do
      tags "Document"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Document ID"

      response "202", "Refresh queued" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub, source_type: "website", config: {base_url: "https://example.com"}) }
        let!(:document) do
          doc = create(:document, source: source, document_type: "blog_post")
          doc.update_column(:sync_status, :complete)
          doc
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:accepted)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, source: source)
          doc.update_column(:sync_status, :complete)
          doc
        end
        let(:Authorization) { nil }
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Document not found" do
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

      response "422", "Document not in a refreshable state" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:source) { create(:source, hub: hub) }
        let!(:document) do
          doc = create(:document, source: source)
          doc.update_column(:sync_status, :error)
          doc
        end
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { document.id }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end
end
