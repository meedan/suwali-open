require "rails_helper"
require "swagger_helper"

RSpec.describe "Topics API", type: :request do
  let!(:user) { create(:user) }
  let!(:hub) { create(:hub, users: [user]) }
  let(:headers) { auth_headers_for(user) }

  context "when listing the topics of a hub" do
    let!(:beta) { create(:topic, hub: hub, name: "Beta") }
    let!(:alpha) { create(:topic, hub: hub, name: "Alpha") }
    let!(:unused) { create(:topic, hub: hub, name: "Zeta") }

    before do
      source = create(:source, hub: hub)
      create(:topic_item, topic: alpha, item: create(:document, source: source))
      create(:topic_item, topic: alpha, item: create(:document, source: source))
      create(:topic_item, topic: alpha, item: create(:notebook, hub: hub))
      create(:topic_item, topic: beta, item: create(:contribution, hub: hub))
    end

    it "lists them by name, with how many items each is on" do
      get "/api/hubs/#{hub.id}/topics", headers: headers

      expect(response).to have_http_status(:ok)
      expect(response.parsed_body["data"]).to eq([
        {"id" => alpha.id, "name" => "Alpha", "items_count" => 3},
        {"id" => beta.id, "name" => "Beta", "items_count" => 1},
        {"id" => unused.id, "name" => "Zeta", "items_count" => 0}
      ])
    end

    it "does not count the messages a topic is on" do
      conversation = create(:conversation, hub: hub)
      message = create(:message, conversation: conversation, direction: "outgoing")
      create(:topic_item, topic: unused, item: message)

      get "/api/hubs/#{hub.id}/topics", headers: headers

      expect(response.parsed_body["data"].find { |topic| topic["id"] == unused.id }["items_count"]).to eq(0)
    end

    it "pages through them" do
      get "/api/hubs/#{hub.id}/topics", params: {per_page: 2, page: 1}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(%w[Alpha Beta])
      expect(response.parsed_body["pagination"]).to include("current_page" => 1, "next_page" => 2, "total_count" => 3)

      get "/api/hubs/#{hub.id}/topics", params: {per_page: 2, page: 2}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(%w[Zeta])
      expect(response.parsed_body["pagination"]).to include("current_page" => 2, "next_page" => nil)
    end

    it "searches them by name, whatever the case, and counts only the matches" do
      get "/api/hubs/#{hub.id}/topics", params: {q: "ET"}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(%w[Beta Zeta])
      expect(response.parsed_body["pagination"]).to include("total_count" => 2)
    end

    it "searches for what is typed, and not as a pattern" do
      create(:topic, hub: hub, name: "100% sure")

      get "/api/hubs/#{hub.id}/topics", params: {q: "%"}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(["100% sure"])
    end

    it "does not list the topics of other hubs" do
      other_hub_topic = create(:topic, name: "Elsewhere")

      get "/api/hubs/#{hub.id}/topics", headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["id"] }).not_to include(other_hub_topic.id)
    end

    it "returns not found if the user is not part of the hub" do
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      get "/api/hubs/#{hub.id}/topics", headers: other_headers

      expect(response).to have_http_status(:not_found)
    end
  end

  context "when listing the topics of a list of the data sources" do
    let!(:source) { create(:source, hub: hub) }
    let!(:other_source) { create(:source, hub: hub) }
    let!(:climate) { create(:topic, hub: hub, name: "Climate") }
    let!(:housing) { create(:topic, hub: hub, name: "Housing") }
    let!(:unused) { create(:topic, hub: hub, name: "Unused") }

    def listed(params)
      get "/api/hubs/#{hub.id}/topics", params: params, headers: headers
      expect(response).to have_http_status(:ok)
      response.parsed_body["data"].to_h { |topic| [topic["name"], topic["items_count"]] }
    end

    context "of documents" do
      before do
        2.times { create(:topic_item, topic: climate, item: create(:document, source: source)) }
        create(:topic_item, topic: housing, item: create(:document, source: other_source))
        create(:topic_item, topic: housing, item: create(:contribution, hub: hub))
        create(:document, source: source)
      end

      it "counts the documents of the source only, and leaves out the topics that are on none of them" do
        expect(listed(item_type: "Document", source_id: source.id)).to eq("Climate" => 2)
      end

      it "says how many documents of the source have no topics" do
        listed(item_type: "Document", source_id: source.id)

        expect(response.parsed_body["untagged_count"]).to eq(1)
      end

      it "returns not found without a source" do
        get "/api/hubs/#{hub.id}/topics", params: {item_type: "Document"}, headers: headers

        expect(response).to have_http_status(:not_found)
      end

      it "leaves out the unsupported documents, which the list shows apart" do
        unsupported = create(:document, source: source)
        unsupported.update_columns(sync_status: Document.sync_statuses[:error], last_sync_error_code: Document::NON_RETRYABLE_ERROR_CODES.first)
        create(:topic_item, topic: unused, item: unsupported)

        expect(listed(item_type: "Document", source_id: source.id)).to eq("Climate" => 2)
        expect(response.parsed_body["untagged_count"]).to eq(1)
      end

      it "returns not found for a source of another hub" do
        foreign_source = create(:source)

        get "/api/hubs/#{hub.id}/topics", params: {item_type: "Document", source_id: foreign_source.id}, headers: headers

        expect(response).to have_http_status(:not_found)
      end
    end

    it "counts the contributions of the hub" do
      create(:topic_item, topic: housing, item: create(:contribution, hub: hub))
      create(:topic_item, topic: housing, item: create(:document, source: source))
      create(:contribution, hub: hub)

      expect(listed(item_type: "Contribution")).to eq("Housing" => 1)
      expect(response.parsed_body["untagged_count"]).to eq(1)
    end

    it "counts the published notebooks of the hub, and not the others" do
      create(:topic_item, topic: climate, item: create(:notebook, hub: hub, user: user, published: true))
      create(:topic_item, topic: housing, item: create(:notebook, hub: hub, user: user, published: false))

      expect(listed(item_type: "Notebook")).to eq("Climate" => 1)
    end

    it "does not offer an item type that has no topics to be managed" do
      get "/api/hubs/#{hub.id}/topics", params: {item_type: "Message"}, headers: headers

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "does not count anything of another hub" do
      other_hub = create(:hub)
      create(:topic_item, topic: create(:topic, hub: other_hub, name: "Climate"), item: create(:contribution, hub: other_hub))

      expect(listed(item_type: "Contribution")).to eq({})
    end

    it "leaves out the untagged count when it is not about a list" do
      get "/api/hubs/#{hub.id}/topics", headers: headers

      expect(response.parsed_body).not_to have_key("untagged_count")
    end
  end

  context "when listing topics by their ids" do
    let!(:climate) { create(:topic, hub: hub, name: "Climate") }
    let!(:housing) { create(:topic, hub: hub, name: "Housing") }
    let!(:other_hub_topic) { create(:topic, name: "Elsewhere") }

    it "lists only those, by name" do
      get "/api/hubs/#{hub.id}/topics", params: {ids: "#{housing.id},#{climate.id}", page: 1}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(%w[Climate Housing])
    end

    it "lists all the topics when the ids are blank" do
      get "/api/hubs/#{hub.id}/topics", params: {ids: "", page: 1}, headers: headers

      expect(response.parsed_body["data"].map { |topic| topic["name"] }).to eq(%w[Climate Housing])
    end

    it "lists none of the topics of another hub, nor what is not an id" do
      get "/api/hubs/#{hub.id}/topics", params: {ids: "#{other_hub_topic.id},abc,", page: 1}, headers: headers

      expect(response.parsed_body["data"]).to eq([])
    end

    it "lists them with how many of the list they are on, even when that is none" do
      create(:topic_item, topic: housing, item: create(:contribution, hub: hub))

      get "/api/hubs/#{hub.id}/topics", params: {ids: "#{climate.id},#{housing.id}", item_type: "Contribution", page: 1}, headers: headers

      expect(response.parsed_body["data"].map { |topic| [topic["name"], topic["items_count"]] }).to eq([["Climate", 0], ["Housing", 1]])
    end
  end
end

# Tests for Swagger / OpenAPI documentation

describe "Topics API" do
  path "/api/hubs/{hub_id}/topics" do
    get "Lists the topics of a hub" do
      tags "Topic"
      produces "application/json"
      security [bearerAuth: []]
      parameter name: :hub_id, in: :path, type: :string, description: "Hub ID"
      parameter name: :q, in: :query, type: :string, required: false, description: "Only the topics whose name contains this, whatever the case"
      parameter name: :page, in: :query, type: :integer, required: false, description: "Page number, from 1"
      parameter name: :per_page, in: :query, type: :integer, required: false, description: "Topics per page, up to 100"
      parameter name: :ids, in: :query, type: :string, required: false, description: "Only the topics with these ids, separated by commas, such as to show the names of those a list is filtered by"
      parameter name: :item_type, in: :query, type: :string, required: false, enum: %w[Document Contribution Notebook], description: "Counts the items of this kind that each topic is on, among those of its list, and leaves out the topics that are on none of them. Adds untagged_count, how many of them have no topics"
      parameter name: :source_id, in: :query, type: :integer, required: false, description: "Required with item_type Document: the data source whose documents are counted"

      response "200", "A page of the topics of the hub, by name, with the number of data source items each is on" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:topic) { create(:topic, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:hub_id) { hub.id }
        let(:q) { nil }
        let(:page) { nil }
        let(:per_page) { nil }
        let(:ids) { nil }
        let(:item_type) { nil }
        let(:source_id) { nil }
        run_test! do |response|
          expect(response.parsed_body["data"]).to eq([{"id" => topic.id, "name" => topic.name, "items_count" => 0}])
          expect(response.parsed_body["pagination"]).to include("current_page" => 1)
        end
      end

      response "401", "Unauthorized" do
        let!(:hub) { create(:hub) }
        let(:Authorization) { nil }
        let(:hub_id) { hub.id }
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
end
