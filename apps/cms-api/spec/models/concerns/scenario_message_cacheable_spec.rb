require "rails_helper"

RSpec.describe ScenarioMessageCacheable do
  describe "Hub" do
    it "enqueues worker when bot_attributes changes" do
      hub = create(:hub)

      expect(FirstMessageCacheWorker).to receive(:perform_async).with(hub.id)
      hub.update!(bot_attributes: {"name" => "NewBot"})
    end

    it "enqueues worker when hub name changes" do
      hub = create(:hub)

      expect(FirstMessageCacheWorker).to receive(:perform_async).with(hub.id)
      hub.update!(name: "New Hub Name")
    end

    it "clears the welcome and closing message caches for every language" do
      hub = create(:hub)

      expect(Rails.cache).to receive(:delete_multi) do |keys|
        expect(keys).to match_array(%w[first_message conversation_closed].product(SUPPORTED_LANGUAGES.keys).map { |scenario, language| "hub/#{hub.id}/#{scenario}/#{language}" })
      end
      hub.update!(bot_attributes: {"name" => "NewBot"})
    end

    it "does not enqueue worker when unrelated attributes change" do
      hub = create(:hub)

      expect(FirstMessageCacheWorker).not_to receive(:perform_async)
      hub.update!(plan: :enterprise)
    end
  end

  describe "ExternalResource" do
    it "enqueues worker when resource changes" do
      hub = create(:hub)
      resource = create(:external_resource, hub: hub)

      expect(FirstMessageCacheWorker).to receive(:perform_async).with(hub.id)
      resource.update!(title: "Updated Resource")
    end

    it "enqueues worker when resource is destroyed" do
      hub = create(:hub)
      resource = create(:external_resource, hub: hub)

      expect(FirstMessageCacheWorker).to receive(:perform_async).with(hub.id)
      resource.destroy!
    end
  end

  describe ".cache_key" do
    it "returns the expected cache key format, with the language when given" do
      expect(ScenarioMessageCacheable.cache_key(42, "first_message")).to eq("hub/42/first_message")
      expect(ScenarioMessageCacheable.cache_key(42, "conversation_closed", "pt")).to eq("hub/42/conversation_closed/pt")
    end
  end
end
