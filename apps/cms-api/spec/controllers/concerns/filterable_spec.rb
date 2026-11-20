require "rails_helper"

RSpec.describe Filterable, type: :controller do
  controller(ActionController::API) do
    include Filterable

    def index
      source = Source.find(params[:source_id])
      render json: apply_filters(source.documents).map(&:id)
    end

    def custom_filter_mappings
      {}
    end
  end

  before do
    routes.draw do
      get "documents" => "anonymous#index"
    end
  end

  let!(:hub) { create(:hub) }
  let!(:source) { create(:source, hub: hub) }
  let!(:doc1) { create(:document, source: source, active: true, priority_tier: 1) }
  let!(:doc2) { create(:document, source: source, active: false, priority_tier: 2) }

  def response_ids
    JSON.parse(response.body)
  end

  describe "status filter" do
    it "returns only active documents" do
      get :index, params: {source_id: source.id, status: "active"}
      expect(response_ids).to contain_exactly(doc1.id)
    end

    it "returns only paused documents" do
      get :index, params: {source_id: source.id, status: "paused"}
      expect(response_ids).to contain_exactly(doc2.id)
    end

    it "returns all documents when set to 'all'" do
      get :index, params: {source_id: source.id, status: "all"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end
  end

  describe "sync_status filter" do
    before do
      doc1.update_column(:sync_status, Document.sync_statuses[:complete])
      doc2.update_column(:sync_status, Document.sync_statuses[:error])
    end

    it "filters by a single status" do
      get :index, params: {source_id: source.id, sync_status: "complete"}
      expect(response_ids).to contain_exactly(doc1.id)
    end

    it "filters by multiple comma-separated statuses" do
      get :index, params: {source_id: source.id, sync_status: "complete,error"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end
  end

  describe "date_modified filter" do
    it "returns documents modified today" do
      get :index, params: {source_id: source.id, date_modified: "today"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end

    it "returns documents modified more than 90 days ago" do
      old_doc = create(:document, source: source, updated_at: 100.days.ago)
      get :index, params: {source_id: source.id, date_modified: "more_than_90"}
      expect(response_ids).to contain_exactly(old_doc.id)
    end

    it "returns all documents when set to 'any'" do
      get :index, params: {source_id: source.id, date_modified: "any"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end
  end

  describe "notebooks filter" do
    let!(:notebook) { create(:notebook, hub: hub) }

    it "returns only documents in a notebook" do
      create(:notebook_item, notebook: notebook, item: doc1)
      get :index, params: {source_id: source.id, notebooks: "true"}
      expect(response_ids).to contain_exactly(doc1.id)
    end

    it "returns only documents not in any notebook" do
      create(:notebook_item, notebook: notebook, item: doc1)
      get :index, params: {source_id: source.id, notebooks: "false"}
      expect(response_ids).to contain_exactly(doc2.id)
    end

    it "returns all documents when set to 'all'" do
      get :index, params: {source_id: source.id, notebooks: "all"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end
  end

  describe "priority_tier filter" do
    it "returns only tier 1 documents" do
      get :index, params: {source_id: source.id, priority_tier: "1"}
      expect(response_ids).to contain_exactly(doc1.id)
    end

    it "returns only tier 2 documents" do
      get :index, params: {source_id: source.id, priority_tier: "2"}
      expect(response_ids).to contain_exactly(doc2.id)
    end

    it "returns all documents when set to 'all'" do
      get :index, params: {source_id: source.id, priority_tier: "all"}
      expect(response_ids).to contain_exactly(doc1.id, doc2.id)
    end
  end
end
