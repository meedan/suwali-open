require "rails_helper"

RSpec.describe AdminHubUpdateForm do
  def params(hash)
    ActionController::Parameters.new(hash)
  end

  describe "#valid? / #attrs" do
    context "with a plan" do
      it "coerces the value to a string and sets it in attrs" do
        form = AdminHubUpdateForm.new(params(plan: "standard"))
        expect(form).to be_valid
        expect(form.attrs[:plan]).to eq("standard")
      end

      it "passes invalid plan values through to attrs without validating them" do
        # Plan validity is enforced by the Hub model (enum validate: true),
        # not by the form. The form only handles coercion.
        form = AdminHubUpdateForm.new(params(plan: "galaxy_brain"))
        expect(form).to be_valid
        expect(form.attrs[:plan]).to eq("galaxy_brain")
      end
    end

    context "with valid trial dates" do
      it "parses YYYY-MM-DD into Date objects" do
        form = AdminHubUpdateForm.new(params(trial_started_at: "2026-01-01", trial_ends_at: "2026-07-01"))
        expect(form).to be_valid
        expect(form.attrs[:trial_started_at]).to eq(Date.new(2026, 1, 1))
        expect(form.attrs[:trial_ends_at]).to eq(Date.new(2026, 7, 1))
      end

      it "coerces blank strings to nil" do
        form = AdminHubUpdateForm.new(params(trial_started_at: "", trial_ends_at: ""))
        expect(form).to be_valid
        expect(form.attrs[:trial_started_at]).to be_nil
        expect(form.attrs[:trial_ends_at]).to be_nil
      end
    end

    context "with valid custom_limits" do
      it "casts string values to integers" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sources: "10", messages: "5000", documents: "2000")))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]).to eq({"sources" => 10, "messages" => 5000, "documents" => 2000})
      end

      it "accepts zero as a valid limit" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sources: "0")))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]["sources"]).to eq(0)
      end

      it "silently drops unpermitted keys" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sources: "10", secret: "999")))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]).not_to have_key("secret")
        expect(form.attrs[:custom_limits]["sources"]).to eq(10)
      end

      it "coerces blank custom_limits to nil" do
        form = AdminHubUpdateForm.new(params(custom_limits: nil))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]).to be_nil
      end

      it "casts the sms toggle to a boolean true" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sms: "true")))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]["sms"]).to be true
      end

      it "casts the sms toggle to a boolean false" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sms: "false")))
        expect(form).to be_valid
        expect(form.attrs[:custom_limits]["sms"]).to be false
      end
    end

    context "with trial_emails_enabled" do
      it "casts true string to boolean true" do
        form = AdminHubUpdateForm.new(params(trial_emails_enabled: "true"))
        expect(form).to be_valid
        expect(form.attrs[:trial_emails_enabled]).to be true
      end

      it "casts false string to boolean false" do
        form = AdminHubUpdateForm.new(params(trial_emails_enabled: "false"))
        expect(form).to be_valid
        expect(form.attrs[:trial_emails_enabled]).to be false
      end

      it "is not included in attrs when not provided" do
        form = AdminHubUpdateForm.new(params(plan: "free"))
        expect(form).to be_valid
        expect(form.attrs).not_to have_key(:trial_emails_enabled)
      end
    end

    context "with only some fields provided" do
      it "only includes provided fields in attrs" do
        form = AdminHubUpdateForm.new(params(plan: "enterprise"))
        expect(form).to be_valid
        expect(form.attrs.keys).to contain_exactly(:plan)
      end

      it "is valid and produces empty attrs when no fields are provided" do
        form = AdminHubUpdateForm.new(params({}))
        expect(form).to be_valid
        expect(form.attrs).to be_empty
      end
    end

    context "with a malformed trial date" do
      it "is invalid for a human-readable date string" do
        form = AdminHubUpdateForm.new(params(trial_started_at: "January 1st 2026", trial_ends_at: "2026-07-01"))
        expect(form).not_to be_valid
        expect(form.errors.full_messages).to include(I18n.t(:error_hub_invalid_date_format))
      end

      it "is invalid for a slash-separated date" do
        form = AdminHubUpdateForm.new(params(trial_started_at: "2026/01/01", trial_ends_at: "2026-07-01"))
        expect(form).not_to be_valid
        expect(form.errors.full_messages).to include(I18n.t(:error_hub_invalid_date_format))
      end
    end

    context "with an invalid custom_limits value" do
      it "is invalid for a non-numeric string" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(sources: "many")))
        expect(form).not_to be_valid
        expect(form.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "sources"))
      end

      it "is invalid for a negative number" do
        form = AdminHubUpdateForm.new(params(custom_limits: params(documents: "-5")))
        expect(form).not_to be_valid
        expect(form.errors.full_messages).to include(I18n.t(:error_hub_invalid_custom_limit, key: "documents"))
      end
    end
  end
end
