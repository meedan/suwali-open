require "rails_helper"
require "rake"

RSpec.describe "backfill_external_resource_types" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("backfill_external_resource_types")
  end

  after do
    Rake::Task["backfill_external_resource_types"].reenable
  end

  def run_task
    Rake::Task["backfill_external_resource_types"].invoke
  end

  it "types links, phone numbers, and email addresses, and lists the rest by hub" do
    hub = create(:hub, name: "Review Hub")
    link = create(:external_resource, hub: hub, title: "https://example.com/help")
    phone = create(:external_resource, hub: hub, title: "+55 71 1234 5678")
    email = create(:external_resource, hub: hub, title: "help@example.com")
    other = create(:external_resource, hub: hub, title: "Where do I vote?")
    typed = create(:external_resource, hub: hub, title: "https://example.com", resource_type: "question")

    expect { run_task }.to output(/Hub ##{hub.id} \(Review Hub\)\n  ##{other.id}\s+Where do I vote\?/).to_stdout

    expect(link.reload.resource_type).to eq("link")
    expect(phone.reload.resource_type).to eq("phone")
    expect(email.reload.resource_type).to eq("email")
    expect(other.reload.resource_type).to be_nil
    expect(typed.reload.resource_type).to eq("question")
  end
end
