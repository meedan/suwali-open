require "rails_helper"

RSpec.describe ExternalResource, type: :model do
  describe "associations" do
    it { should belong_to(:hub) }
  end

  describe "validations" do
    it { should validate_presence_of(:title) }

    it "validates scenarios is not empty" do
      external_resource = build(:external_resource, scenarios: [])
      expect(external_resource).not_to be_valid
      expect(external_resource.errors[:base][0]).to include("can't be empty")
    end

    it "validates scenarios is not nil" do
      external_resource = build(:external_resource, scenarios: nil)
      expect(external_resource).not_to be_valid
      expect(external_resource.errors[:base][0]).to include("can't be empty")
    end

    it "validates scenarios contains only valid values" do
      external_resource = build(:external_resource, scenarios: ["role_description", "invalid_scenario"])
      expect(external_resource).not_to be_valid
      expect(external_resource.errors[:base][0]).to include("Invalid")
    end

    it "allows valid scenarios" do
      external_resource = build(:external_resource, scenarios: ["role_description", "unanswerable_question", "error_occurred", "first_message"])
      expect(external_resource).to be_valid
    end

    it { should validate_inclusion_of(:resource_type).in_array(ExternalResource::RESOURCE_TYPES).allow_nil }
    it { should validate_length_of(:description).is_at_most(ExternalResource::MAX_DESCRIPTION_LENGTH) }

    # what the form saves, including addresses it keeps with non-ASCII characters as typed
    ["https://example.com/help", "https://www.example.com/help?a=1", "HTTP://example.com", "http://localhost:3000",
      "http://192.168.0.1:8080/feed", "https://bücher.example/", "https://example.com/página"].each do |title|
      it "takes #{title} as a link" do
        expect(build(:external_resource, resource_type: "link", title: title)).to be_valid
      end
    end

    ["asdf", "https://", "ftp://example.com", "mailto:help@example.com", "http://example.com:port"].each do |title|
      it "refuses #{title} as a link" do
        resource = build(:external_resource, resource_type: "link", title: title)
        expect(resource).not_to be_valid
        expect(resource.errors[:base]).to include(I18n.t(:error_resource_link_invalid))
      end
    end

    it "takes a phone number the form saves, or one typed with separators" do
      expect(build(:external_resource, resource_type: "phone", title: "+15551234567")).to be_valid
      expect(build(:external_resource, resource_type: "phone", title: "+55 71 1234-5678")).to be_valid
      expect(build(:external_resource, resource_type: "phone", title: "911")).not_to be_valid
    end

    it "takes an email address the form takes" do
      expect(build(:external_resource, resource_type: "email", title: "help@example.com")).to be_valid
      expect(build(:external_resource, resource_type: "email", title: "help at example.com")).not_to be_valid
    end

    it "caps a question at the form's length" do
      at_limit = "a" * (ExternalResource::MAX_QUESTION_LENGTH - 1) + "?"
      expect(build(:external_resource, resource_type: "question", title: at_limit)).to be_valid
      expect(build(:external_resource, resource_type: "question", title: at_limit + "?")).not_to be_valid
    end

    it "leaves untyped resources saved before the type existed alone" do
      expect(build(:external_resource, resource_type: nil, title: "anything at all")).to be_valid
    end
  end

  describe "#as_json" do
    it "returns the correct JSON structure" do
      external_resource = create(:external_resource,
        title: "https://example.com/guide",
        resource_type: "link",
        scenarios: ["role_description", "unanswerable_question"],
        description: "Test description")

      json = external_resource.as_json

      expect(json[:id]).to eq(external_resource.id)
      expect(json[:title]).to eq("https://example.com/guide")
      expect(json[:resource_type]).to eq("link")
      expect(json[:scenarios]).to eq(["role_description", "unanswerable_question"])
      expect(json[:description]).to eq("Test description")
      expect(json[:created_at]).to eq(external_resource.created_at)
      expect(json[:updated_at]).to eq(external_resource.updated_at)
    end
  end

  describe "trial restrictions" do
    it "allows creating external resource on premium hub" do
      hub = create(:hub, plan: :enterprise)
      resource = build(:external_resource, hub: hub)
      expect(resource).to be_valid
    end

    it "allows creating external resource on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      resource = build(:external_resource, hub: hub)
      expect(resource).to be_valid
    end

    it "rejects creating external resource on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      resource = build(:external_resource, hub: hub)
      expect(resource).not_to be_valid
      expect(resource.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "rejects creating external resource on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      resource = build(:external_resource, hub: hub)
      expect(resource).not_to be_valid
      expect(resource.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end
end
