require "rails_helper"

RSpec.describe "About API", type: :request do
  it "allows access if user is logged in" do
    user = create(:user, email: Faker::Internet.email)
    headers = auth_headers_for(user)
    get "/api/about", headers: headers
    expect(response).to have_http_status(:ok)

    json = JSON.parse(response.body)

    expect(json).to include(
      "google_drive_share_email",
      "hub_trial_length_days",
      "languages"
    )
    expect(json["conversation_inactivity_timeout_minutes"]).to eq(Conversation.inactivity_timeout.in_minutes.to_i)
    expect(json["max_summary_length"]).to eq(Document::MAX_SUMMARY_LENGTH)
    expect(json["max_topic_name_length"]).to eq(Topicable::MAX_TOPIC_NAME_LENGTH)
    expect(json["max_resource_question_length"]).to eq(ExternalResource::MAX_QUESTION_LENGTH)
    expect(json["max_resource_description_length"]).to eq(ExternalResource::MAX_DESCRIPTION_LENGTH)
    expect(json["schedule_demo_link"]).to eq(AppInfo.schedule_demo_link)

    languages = json["languages"]
    expect(languages).to be_an(Array)
    expect(languages.first).to include("code", "name")
    codes = languages.map { |l| l["code"] }
    expect(codes).to include("en", "pt", "es")

    sms_countries = json["sms_countries"]
    expect(sms_countries).to be_an(Array)
    expect(sms_countries.first).to include("code", "name", "number_types")
    us = sms_countries.find { |c| c["code"] == "US" }
    expect(us["number_types"]).to eq(%w[tollfree local])
  end

  it "exposes the Google OAuth and Picker configuration only when set" do
    vars = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_PICKER_API_KEY", "GOOGLE_PICKER_APP_ID"]
    originals = vars.index_with { |var| ENV[var] }
    user = create(:user, email: Faker::Internet.email)
    headers = auth_headers_for(user)

    vars.each { |var| ENV.delete(var) }
    get "/api/about", headers: headers
    json = JSON.parse(response.body)
    expect(json["google_oauth_client_id"]).to be_nil
    expect(json["google_picker_api_key"]).to be_nil
    expect(json["google_picker_app_id"]).to be_nil

    ENV["GOOGLE_OAUTH_CLIENT_ID"] = "client-1"
    ENV["GOOGLE_PICKER_API_KEY"] = "key-1"
    ENV["GOOGLE_PICKER_APP_ID"] = "12345"
    get "/api/about", headers: headers
    json = JSON.parse(response.body)
    expect(json["google_oauth_client_id"]).to eq("client-1")
    expect(json["google_picker_api_key"]).to eq("key-1")
    expect(json["google_picker_app_id"]).to eq("12345")
  ensure
    originals.each { |var, value| value.nil? ? ENV.delete(var) : ENV[var] = value }
  end

  it "returns the enterprise plan without any hub's custom limits" do
    user = create(:user, email: Faker::Internet.email)
    create(:hub, plan: :enterprise, custom_limits: {"messages" => 20000, "sources" => 10, "documents" => 8000}, users: [user])

    get "/api/about", headers: auth_headers_for(user)

    json = JSON.parse(response.body)
    expect(json["plans"]["enterprise"]).to eq("messages" => nil, "sources" => nil, "documents" => nil)
  end

  it "forbids access if user is not logged in" do
    get "/api/about"
    expect(response).to have_http_status(:unauthorized)
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "About API" do
  path "/api/about" do
    get "Gets information about the application" do
      tags "About"
      consumes "application/json"
      security [bearerAuth: []]

      response "200", "Information returned" do
        let!(:user) { create(:user) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end
    end
  end
end
