require "rails_helper"

RSpec.describe SmartPagination, type: :controller do
  controller(ActionController::API) do
    include SmartPagination

    def index
      result = paginate(Hub.all)
      render json: result.merge(data: result[:data].map { |h| {id: h.id, name: h.name} })
    end

    def index_with_count
      result = paginate(Hub.all, 99)
      render json: result.merge(data: result[:data].map { |h| {id: h.id, name: h.name} })
    end

    def index_ordered
      result = paginate(Hub.order(name: :asc))
      render json: result.merge(data: result[:data].map { |h| {id: h.id, name: h.name} })
    end

    def index_custom_sort
      result = paginate(Hub.where(name: %w[b aaa cc]))
      render json: result.merge(data: result[:data].map { |h| {id: h.id, name: h.name} })
    end

    def index_documents
      source = Source.find(params[:source_id])
      result = paginate(source.documents)
      render json: result.merge(data: result[:data].map { |d| {id: d.id, priority_tier: d.priority_tier} })
    end

    private

    def apply_custom_sort(collection, sort_by, sort_direction)
      return super unless sort_by == "name"

      collection.order(Arel.sql("LENGTH(name) #{(sort_direction == "asc") ? "ASC" : "DESC"}"))
    end
  end

  before do
    routes.draw do
      get "index" => "anonymous#index"
      get "index_with_count" => "anonymous#index_with_count"
      get "index_ordered" => "anonymous#index_ordered"
      get "index_custom_sort" => "anonymous#index_custom_sort"
      get "sources/:source_id/documents" => "anonymous#index_documents"
    end
  end

  before { create_list(:hub, 3) }

  it "returns data and pagination keys at the top level" do
    get :index
    expect(response.parsed_body.keys).to match_array(%w[data pagination])
  end

  it "includes all pagination keys" do
    get :index
    expect(response.parsed_body["pagination"].keys).to match_array(%w[
      current_page per_page total_pages total_count next_page prev_page first_page last_page
    ])
  end

  it "reflects the collection size in total_count and total_pages" do
    get :index
    pagination = response.parsed_body["pagination"]
    expect(pagination["total_count"]).to eq(3)
    expect(pagination["total_pages"]).to eq(1)
  end

  it "uses the provided total_count instead of counting the collection" do
    get :index_with_count
    expect(response.parsed_body.dig("pagination", "total_count")).to eq(99)
  end

  it "preserves the collection's order when it has order_values" do
    get :index_ordered
    names = response.parsed_body["data"].map { |h| h["name"] }
    expect(names).to eq(names.sort)
  end

  describe "custom sort hook" do
    before { %w[b aaa cc].each { |name| create(:hub, name: name) } }

    it "orders by the controller's custom sort when it handles the sort_by" do
      get :index_custom_sort, params: {sort_by: "name", sort_direction: "asc"}

      expect(response.parsed_body["data"].map { |h| h["name"] }).to eq(%w[b cc aaa])
    end

    it "honors the requested direction in the custom sort" do
      get :index_custom_sort, params: {sort_by: "name", sort_direction: "desc"}

      expect(response.parsed_body["data"].map { |h| h["name"] }).to eq(%w[aaa cc b])
    end

    it "keeps the default ordering for a sort_by the controller does not handle" do
      get :index_custom_sort, params: {sort_by: "created_at", sort_direction: "asc"}

      expect(response.parsed_body["data"].map { |h| h["name"] }).to eq(%w[b aaa cc])
    end
  end

  describe "sorting by priority_tier" do
    let!(:hub) { create(:hub) }
    let!(:source) { create(:source, hub: hub) }
    let!(:important_doc) { create(:document, source: source, priority_tier: 2) }
    let!(:default_doc) { create(:document, source: source, priority_tier: 1) }

    it "sorts ascending with default tier first" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "asc"}
      ids = response.parsed_body["data"].map { |d| d["id"] }
      expect(ids.index(default_doc.id)).to be < ids.index(important_doc.id)
    end

    it "sorts descending with important tier first" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "desc"}
      ids = response.parsed_body["data"].map { |d| d["id"] }
      expect(ids.index(important_doc.id)).to be < ids.index(default_doc.id)
    end

    it "falls back to updated_at when sort_by is not an allowed column" do
      get :index_documents, params: {source_id: source.id, sort_by: "invalid_column"}
      expect(response).to have_http_status(:ok)
    end
  end

  describe "a window around a record that ties with others on the sort value" do
    let!(:source) { create(:source, hub: create(:hub)) }
    let!(:documents) { create_list(:document, 7, source: source, priority_tier: 1).sort_by(&:id) }

    it "takes the records before and after the target by id, in id order" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "asc", around_id: documents[3].id, window_size: 4}

      expect(response.parsed_body["data"].map { |d| d["id"] }).to eq(documents[1..5].map(&:id))
      expect(response.parsed_body["pagination"]).to include("has_previous" => true, "has_next" => true)
    end

    it "orders the tied records by id descending in a descending sort" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "desc", around_id: documents[3].id, window_size: 4}

      expect(response.parsed_body["data"].map { |d| d["id"] }).to eq(documents[1..5].map(&:id).reverse)
      expect(response.parsed_body["pagination"]).to include("has_previous" => true, "has_next" => true)
    end
  end

  describe "a window around a tied record that reaches records with other sort values" do
    let!(:source) { create(:source, hub: create(:hub)) }
    let!(:documents) { [-1, 1, 1, 1, 2].map { |tier| create(:document, source: source, priority_tier: tier) } }

    it "takes the neighbours by sort value first and id second" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "asc", around_id: documents[2].id, window_size: 4}

      expect(response.parsed_body["data"].map { |d| d["id"] }).to eq(documents.map(&:id))
    end
  end

  describe "a window around a record outside the collection" do
    let!(:source) { create(:source, hub: create(:hub)) }
    let!(:documents) { [2, -1, 1].map { |tier| create(:document, source: source, priority_tier: tier) } }
    let!(:other_document) { create(:document, source: create(:source, hub: source.hub)) }

    it "starts the window at the first record in sort order" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "asc", around_id: other_document.id, window_size: 20}

      expect(response.parsed_body["data"].map { |d| d["id"] }).to eq(documents.values_at(1, 2, 0).map(&:id))
      expect(response.parsed_body["pagination"]).to include("type" => "permalink", "target_record_id" => documents[1].id, "has_previous" => false)
    end

    it "starts the window at the last record in sort order with anchor=last" do
      get :index_documents, params: {source_id: source.id, sort_by: "priority_tier", sort_direction: "asc", around_id: other_document.id, anchor: "last", window_size: 20}

      expect(response.parsed_body["pagination"]).to include("type" => "permalink", "target_record_id" => documents[0].id, "has_next" => false)
    end

    context "with a custom sort" do
      before { %w[b aaa cc].each { |name| create(:hub, name: name) } }

      let!(:outside_hub) { create(:hub, name: "dddd") }

      it "starts the window at the first record in the custom order" do
        get :index_custom_sort, params: {sort_by: "name", sort_direction: "asc", around_id: outside_hub.id, window_size: 20}

        expect(response.parsed_body["data"].map { |h| h["name"] }).to eq(%w[b cc aaa])
        expect(response.parsed_body["pagination"]).to include("type" => "permalink", "target_record_id" => Hub.find_by(name: "b").id, "has_previous" => false)
      end

      it "starts the window at the last record in the custom order with anchor=last" do
        get :index_custom_sort, params: {sort_by: "name", sort_direction: "asc", around_id: outside_hub.id, anchor: "last", window_size: 20}

        expect(response.parsed_body["pagination"]).to include("type" => "permalink", "target_record_id" => Hub.find_by(name: "aaa").id, "has_next" => false)
      end
    end
  end

  describe "per_page bounds" do
    it "falls back to a valid page size when per_page is zero" do
      get :index, params: {per_page: 0}
      expect(response).to have_http_status(:ok)
    end

    it "falls back to a valid page size when per_page is not numeric" do
      get :index, params: {per_page: "abc"}
      expect(response).to have_http_status(:ok)
    end

    it "falls back to a valid page size when per_page is negative" do
      get :index, params: {per_page: -5}
      expect(response).to have_http_status(:ok)
    end

    it "still caps per_page at 100" do
      get :index, params: {per_page: 5000}
      expect(response.parsed_body.dig("pagination", "per_page")).to eq(100)
    end
  end

  describe "window_size bounds" do
    it "returns a window when window_size is zero" do
      get :index, params: {window_size: 0}
      expect(response).to have_http_status(:ok)
    end

    it "returns a window when window_size is negative" do
      get :index, params: {window_size: -5}
      expect(response).to have_http_status(:ok)
    end
  end
end
