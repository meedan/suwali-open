module ScenarioMessageCacheable
  extend ActiveSupport::Concern

  included do
    after_commit :invalidate_scenario_message_cache, if: :scenario_message_cache_relevant_change?
  end

  def self.cache_key(hub_id, scenario, language = nil)
    ["hub", hub_id, scenario, language].compact.join("/")
  end

  private

  def scenario_message_cache_relevant_change?
    case self
    when Hub
      saved_change_to_bot_attributes? || saved_change_to_name?
    when ExternalResource
      true
    end
  end

  def scenario_message_cache_hub_id
    case self
    when Hub then id
    when ExternalResource then hub_id
    end
  end

  def invalidate_scenario_message_cache
    hid = scenario_message_cache_hub_id
    return unless hid

    keys = %w[first_message conversation_closed].product(SUPPORTED_LANGUAGES.keys).map do |scenario, language|
      ScenarioMessageCacheable.cache_key(hid, scenario, language)
    end
    Rails.cache.delete_multi(keys)
    FirstMessageCacheWorker.perform_async(hid)
  end
end
