require "rails_helper"

RSpec.describe SmsMessagingIntegration, type: :model do
  let(:integration) { create(:sms_messaging_integration, active: true, credentials: {provider: "twilio"}) }
  let(:provider) { instance_double(SmsProviders::Twilio) }

  before { allow(SmsProviders).to receive(:for).and_return(provider) }

  it "reports the sms platform" do
    expect(integration.platform).to eq("sms")
  end

  it "builds the webhook URL from the integration id" do
    expect(integration.webhook_url).to end_with("/api/webhooks/sms/#{integration.id}")
  end

  describe "#rcs_enabled?" do
    it "is false without an RCS agent recorded" do
      expect(integration.rcs_enabled?).to be(false)
    end

    it "is true once an RCS agent id is set, and is surfaced in as_json" do
      integration.set_setting(:rcs_agent_id, "acme_agent")
      integration.save!
      allow(provider).to receive(:registration_status).and_return(nil)

      expect(integration.rcs_enabled?).to be(true)
      expect(integration.as_json["rcs_enabled"]).to be(true)
    end
  end

  describe "provisioning area code" do
    it "rejects an area code that is not three digits" do
      hub = create(:hub, custom_limits: {"sms" => true})
      record = SmsMessagingIntegration.new(hub: hub, active: true, credentials: {provider: "twilio"}, provisioning_area_code: "71a")

      expect(record.save).to be(false)
      expect(record.errors[:base]).to include(I18n.t(:error_sms_invalid_area_code))
    end

    it "rejects a state and an area code together" do
      hub = create(:hub, custom_limits: {"sms" => true})
      record = SmsMessagingIntegration.new(hub: hub, active: true, credentials: {provider: "twilio"}, provisioning_state: "NY", provisioning_area_code: "718")

      expect(record.save).to be(false)
      expect(record.errors[:base]).to include(I18n.t(:error_sms_state_and_area_code))
    end
  end

  describe "SMS plan limit" do
    it "cannot be created for a hub without SMS enabled in custom_limits" do
      hub = create(:hub, custom_limits: {})
      record = SmsMessagingIntegration.new(hub: hub, active: true, credentials: {provider: "twilio"})

      expect(record.save).to be(false)
      expect(record.errors[:base]).to include(I18n.t(:error_plan_restriction_sms_not_available))
    end

    it "can be created when the hub has SMS enabled" do
      hub = create(:hub, custom_limits: {"sms" => true})
      record = SmsMessagingIntegration.new(hub: hub, active: true, credentials: {provider: "twilio"})

      expect(record.save).to be(true)
    end
  end

  describe "#provision_number!" do
    it "provisions a toll-free number by default and records the toll-free regime" do
      allow(provider).to receive(:provision_number).with(country: "US", type: "tollfree", friendly_name: integration.hub.name.first(64), region: nil, area_code: nil).and_return("+18885550000")

      integration.provision_number!(country: "US")

      expect(integration.reload.get_credential(:phone_number)).to eq("+18885550000")
      expect(integration.registration[:country]).to eq("US")
      expect(integration.registration[:number_type]).to eq("tollfree")
      expect(integration.registration[:registration_type]).to eq("us_tollfree")
    end

    it "provisions a local number under the 10DLC regime" do
      allow(provider).to receive(:provision_number).with(country: "US", type: "local", friendly_name: integration.hub.name.first(64), region: nil, area_code: nil).and_return("+15551230000")

      integration.provision_number!(country: "US", type: "local")

      expect(integration.reload.registration[:number_type]).to eq("local")
      expect(integration.registration[:registration_type]).to eq("us_10dlc")
    end

    it "passes the state preference for local numbers" do
      allow(provider).to receive(:provision_number).with(country: "US", type: "local", friendly_name: integration.hub.name.first(64), region: "CA", area_code: nil).and_return("+15551230000")

      integration.provisioning_state = "CA"
      integration.provision_number!(country: "US", type: "local")

      expect(integration.reload.get_credential(:phone_number)).to eq("+15551230000")
    end

    it "ignores the state preference for toll-free numbers" do
      allow(provider).to receive(:provision_number).with(country: "US", type: "tollfree", friendly_name: integration.hub.name.first(64), region: nil, area_code: nil).and_return("+18885550000")

      integration.provisioning_state = "CA"
      integration.provision_number!(country: "US", type: "tollfree")

      expect(integration.reload.get_credential(:phone_number)).to eq("+18885550000")
    end

    it "passes the area code for local numbers" do
      allow(provider).to receive(:provision_number).with(country: "US", type: "local", friendly_name: integration.hub.name.first(64), region: nil, area_code: "718").and_return("+17185550000")

      integration.provisioning_area_code = "718"
      integration.provision_number!(country: "US", type: "local")

      expect(integration.reload.get_credential(:phone_number)).to eq("+17185550000")
    end

    it "names the area code when it has no numbers available" do
      allow(provider).to receive(:provision_number).and_raise(SmsProviders::Base::NoNumbersAvailable, "No available local numbers for US")
      integration.provisioning_area_code = "212"

      expect { integration.provision_number!(country: "US", type: "local") }.to raise_error(ActiveRecord::RecordInvalid)
      expect(integration.errors[:base]).to include(I18n.t(:error_sms_area_code_unavailable, area_code: "212"))
    end

    it "leaves an unknown-regime country without a registration type" do
      allow(provider).to receive(:provision_number).and_return("+441234567890")

      integration.provision_number!(country: "GB")

      expect(integration.registration[:registration_type]).to be_nil
      expect(integration.registration[:country]).to eq("GB")
    end
  end

  describe "provisioning number type" do
    it "defaults to tollfree" do
      expect(SmsMessagingIntegration.new.provisioning_number_type).to eq("tollfree")
    end

    it "rejects a number type not offered for the country" do
      record = SmsMessagingIntegration.new(hub: create(:hub, custom_limits: {"sms" => true}), credentials: {provider: "twilio"})
      record.provisioning_country = "US"
      record.provisioning_number_type = "mobile"

      expect(record.save).to be(false)
      expect(record.errors[:base]).to include(I18n.t(:error_sms_unsupported_number_type))
    end

    it "lists the number types offered per country" do
      expect(SmsMessagingIntegration.number_types_for("US")).to eq(%w[tollfree local])
      expect(SmsMessagingIntegration.number_types_for("GB")).to eq(%w[tollfree])
    end
  end

  describe "#configure_webhook!" do
    it "points the number's inbound webhook at this integration's endpoint" do
      integration.set_credential(:phone_number, "+18885550000")
      allow(provider).to receive(:configure_inbound_webhook)

      integration.configure_webhook!

      expect(provider).to have_received(:configure_inbound_webhook)
        .with(phone_number: "+18885550000", url: integration.webhook_url)
    end
  end

  describe "webhook wiring on create" do
    it "wires the webhook after a provisioned number is created" do
      allow(provider).to receive(:provision_number).and_return("+18885550000")
      allow(provider).to receive(:configure_inbound_webhook)

      created = create(:sms_messaging_integration, credentials: {provider: "twilio"}, provisioning_country: "US")

      expect(provider).to have_received(:configure_inbound_webhook)
        .with(phone_number: "+18885550000", url: created.webhook_url)
    end

    it "does not roll back the created record when webhook configuration fails" do
      allow(provider).to receive(:provision_number).and_return("+18885550000")
      allow(provider).to receive(:configure_inbound_webhook).and_raise(SmsProviders::Base::Error.new("boom"))

      created = create(:sms_messaging_integration, credentials: {provider: "twilio"}, provisioning_country: "US")

      expect(SmsMessagingIntegration.exists?(created.id)).to be(true)
    end
  end

  describe "#set_registration_reference" do
    it "merges a reference into the stored registration without dropping existing keys" do
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "country" => "US"})

      integration.set_registration_reference(:brand_sid, "BN123")

      expect(integration.registration[:brand_sid]).to eq("BN123")
      expect(integration.registration[:country]).to eq("US")
    end
  end

  describe "#registration_status" do
    it "is nil without a modeled regime, without polling the provider" do
      expect(provider).not_to receive(:registration_status)
      expect(integration.registration_status).to be_nil
    end

    it "polls the provider status through a 5-minute cache when a regime is set" do
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "country" => "US", "brand_sid" => "BN1"})
      integration.save!
      allow(provider).to receive(:registration_status).and_return("approved")
      expect(Rails.cache).to receive(:fetch).with("sms_registration_status/#{integration.id}", expires_in: 5.minutes, skip_nil: true).and_call_original

      expect(integration.registration_status).to eq("approved")
    end

    it "returns nil and logs when the provider raises" do
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "brand_sid" => "BN1"})
      integration.save!
      allow(provider).to receive(:registration_status).and_raise(SmsProviders::Base::Error.new("boom"))
      allow(LogService).to receive(:log)

      expect(integration.registration_status).to be_nil
      expect(LogService).to have_received(:log).with(:error, "SmsMessagingIntegration", /Failed to fetch SMS registration status/)
    end

    it "does not cache a failed poll, so the next call retries the provider" do
      allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::MemoryStore.new)
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "brand_sid" => "BN1"})
      integration.save!
      allow(LogService).to receive(:log)
      allow(provider).to receive(:registration_status).and_raise(SmsProviders::Base::Error.new("boom"))
      expect(integration.registration_status).to be_nil

      allow(provider).to receive(:registration_status).and_return("approved")
      expect(integration.registration_status).to eq("approved")
    end

    it "caches a successful poll" do
      allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::MemoryStore.new)
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "brand_sid" => "BN1"})
      integration.save!
      expect(provider).to receive(:registration_status).once.and_return("approved")

      expect(integration.registration_status).to eq("approved")
      expect(integration.registration_status).to eq("approved")
    end
  end

  describe "#approved_for_sending?" do
    context "with a modeled regime (US 10DLC)" do
      before do
        integration.set_setting(:registration, {"registration_type" => "us_10dlc", "brand_sid" => "BN1"})
        integration.save!
      end

      it "is true only when the polled status is approved" do
        allow(provider).to receive(:registration_status).and_return("approved")
        expect(integration.approved_for_sending?).to be(true)
      end

      it "is false for any non-approved status" do
        allow(provider).to receive(:registration_status).and_return("campaign_pending")
        expect(integration.approved_for_sending?).to be(false)
      end
    end

    context "without a modeled regime (flexible)" do
      it "is true and does not poll the provider" do
        integration.set_setting(:registration, {"registration_type" => nil, "country" => "BR"})
        integration.save!
        expect(provider).not_to receive(:registration_status)

        expect(integration.approved_for_sending?).to be(true)
      end
    end
  end

  describe "#as_json" do
    it "surfaces provider, number, country and live registration status; never credentials" do
      integration.set_credential(:phone_number, "+15551230000")
      integration.set_setting(:registration, {"registration_type" => "us_10dlc", "country" => "US", "brand_sid" => "BN1"})
      integration.save!
      allow(provider).to receive(:registration_status).and_return("brand_approved")

      json = integration.as_json
      expect(json["provider"]).to eq("twilio")
      expect(json["phone_number"]).to eq("+15551230000")
      expect(json["country"]).to eq("US")
      expect(json["registration_type"]).to eq("us_10dlc")
      expect(json["registration_status"]).to eq("brand_approved")
      expect(json["credentials"]).to be_nil
    end

    it "surfaces the public opt-in URL only once a brand name is recorded" do
      allow(provider).to receive(:registration_status).and_return(nil)
      expect(integration.as_json["opt_in_url"]).to be_nil

      integration.set_setting(:sms_brand_name, "Acme News LLC")
      integration.save!
      expect(integration.as_json["opt_in_url"]).to end_with("/sms-opt-in/#{integration.hub_id}/#{integration.id}")
    end

    it "does not expose the raw settings jsonb (internal provider references)" do
      integration.set_setting(:registration, {"registration_type" => "us_tollfree", "tollfree_verification_sid" => "HH_secret"})
      integration.save!
      allow(provider).to receive(:registration_status).and_return("pending")

      json = integration.as_json
      expect(json).not_to have_key("settings")
      expect(json.to_s).not_to include("HH_secret")
    end
  end

  describe "provisioning country allowlist" do
    it "cannot be created with an unsupported provisioning country, and provisions nothing" do
      allow(provider).to receive(:provision_number)
      hub = create(:hub, custom_limits: {"sms" => true})
      record = SmsMessagingIntegration.new(hub: hub, active: true, credentials: {provider: "twilio"}, provisioning_country: "GB")

      expect(record.save).to be(false)
      expect(record.errors[:base]).to include(I18n.t(:error_sms_unsupported_country))
      expect(provider).not_to have_received(:provision_number)
    end
  end
end
