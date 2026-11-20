require "rails_helper"

RSpec.describe FirstMessageCacheWorker, type: :worker do
  let(:hub) { create(:hub, bot_attributes: {"name" => "TestBot", "tone" => "journalist"}) }

  it "generates the message in the hub's default language" do
    hub.update!(bot_attributes: hub.bot_attributes.merge("default_language" => "es"))
    expect(Hub).to receive(:find_by).with(id: hub.id).and_return(hub)
    expect(hub).to receive(:generate_and_cache_first_message).with("es")

    described_class.new.perform(hub.id)
  end

  it "does nothing if hub does not exist" do
    expect(KnowledgeService).not_to receive(:preview)
    described_class.new.perform(999999)
  end

  it "re-raises KnowledgeService errors for Sidekiq retry" do
    allow(Hub).to receive(:find_by).with(id: hub.id).and_return(hub)
    allow(hub).to receive(:generate_and_cache_first_message).and_raise(KnowledgeService::Error.new("Service down"))

    expect {
      described_class.new.perform(hub.id)
    }.to raise_error(KnowledgeService::Error)
  end
end
