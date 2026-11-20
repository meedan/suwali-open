class MessagingIntegration < ApplicationRecord
  include TrialRestrictable

  belongs_to :hub

  encrypts :credentials

  validates :type, uniqueness: {scope: :hub_id}

  def as_json(options = {})
    super.merge({"platform" => platform}).except("credentials", :credentials, "settings", :settings)
  end

  def get_credential(key)
    credentials.to_h.with_indifferent_access[key.to_sym]
  end

  def set_credential(key, value)
    new_credentials = credentials.to_h.clone
    new_credentials[key.to_s] = value
    self.credentials = new_credentials
  end

  def get_setting(key)
    settings.to_h.with_indifferent_access[key.to_sym]
  end

  def set_setting(key, value)
    new_settings = settings.to_h.clone
    new_settings[key.to_s] = value
    self.settings = new_settings
  end
end
