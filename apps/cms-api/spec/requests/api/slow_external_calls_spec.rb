require "rails_helper"

# Non-transactional so the request's own audit transaction is the only one open: under the
# fixture transaction every slow call would look "idle in transaction", fixed or not.
RSpec.describe "Slow external calls during a request", type: :request do
  self.use_transactional_tests = false

  after do
    # Postgres kills the session on timeout; reconnect before cleaning up.
    ActiveRecord::Base.connection.reconnect!
    DatabaseCleaner.clean_with(:deletion)
  end

  def outlast_idle_in_transaction_timeout(result)
    ActiveRecord::Base.connection.execute("SET idle_in_transaction_session_timeout = '1ms'")
    sleep 0.01
    result
  end

  def member_of_new_hub
    user = create(:user)
    [create(:hub, users: [user]), auth_headers_for(user)]
  end

  it "previews a hub response when the Knowledge Service outlasts Postgres' idle-in-transaction timeout" do
    hub, headers = member_of_new_hub
    allow(KnowledgeService).to receive(:preview) { outlast_idle_in_transaction_timeout("I help users.") }

    post "/api/hubs/#{hub.id}/preview?scenario=role_description", headers: headers

    expect(response).to have_http_status(:ok)
  end

  it "previews a source when the fetch outlasts Postgres' idle-in-transaction timeout" do
    hub, headers = member_of_new_hub
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:preview) { outlast_idle_in_transaction_timeout([[], 0, nil]) }

    post "/api/sources/preview", params: {source: {hub_id: hub.id, source_type: "website", config: {base_url: "https://example.org/posts"}}}, headers: headers

    expect(response).to have_http_status(:ok)
  end

  it "configures a source when the fetch outlasts Postgres' idle-in-transaction timeout" do
    hub, headers = member_of_new_hub
    ingestor = instance_double(SourceIngestors::Website)
    allow(SourceIngestors::Website).to receive(:new).and_return(ingestor)
    allow(ingestor).to receive(:configure) { outlast_idle_in_transaction_timeout({type: "css"}) }

    post "/api/sources/configure", params: {source: {hub_id: hub.id, source_type: "website", config: {base_url: "https://example.org/posts"}}}, headers: headers

    expect(response).to have_http_status(:ok)
  end
end
