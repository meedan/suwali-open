require "rails_helper"

RSpec.describe "SMS opt-in page", type: :request do
  let(:hub) { create(:hub, name: "Election Desk", custom_limits: {"sms" => true}) }
  let(:integration) { create(:sms_messaging_integration, hub: hub, active: true, credentials: {provider: "twilio", phone_number: "+15550001111"}) }

  before do
    integration.set_setting(:sms_brand_name, "Acme News LLC")
    integration.save!
  end

  it "renders the hub name, number, sender and required disclosures" do
    get "/sms-opt-in/#{hub.id}/#{integration.id}"

    expect(response).to have_http_status(:ok)
    expect(response.body).to include("Election Desk SMS Q&amp;A", "+15550001111", "Acme News LLC", "Message and data rates may apply", "STOP", "https://www.suwali.io/privacy-policy/")
  end

  it "is not found until a brand name is recorded, when inactive, or under another hub" do
    other_hub = create(:hub)

    get "/sms-opt-in/#{other_hub.id}/#{integration.id}"
    expect(response).to have_http_status(:not_found)

    integration.update!(active: false)
    get "/sms-opt-in/#{hub.id}/#{integration.id}"
    expect(response).to have_http_status(:not_found)

    integration.update!(active: true)
    integration.set_setting(:sms_brand_name, nil)
    integration.save!
    get "/sms-opt-in/#{hub.id}/#{integration.id}"
    expect(response).to have_http_status(:not_found)
  end
end
