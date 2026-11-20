class SignalMessagingIntegration < MessagingIntegration
  DEVICE_NAME = "Suwali"

  validate :check_phone_number

  before_create :start_link!, if: -> { get_credential(:phone_number).blank? }
  after_create_commit :enqueue_link_completion, if: -> { get_setting(:link_status) == "pending" }
  # signal-cli would otherwise keep the account's keys and contacts, and keep receiving its messages
  after_destroy_commit :enqueue_account_data_deletion, if: -> { get_credential(:phone_number).present? }

  def self.for_account(phone_number)
    return nil if phone_number.blank?
    where(active: true).find { |integration| integration.get_credential(:phone_number) == phone_number }
  end

  # Signal identifies a message by its timestamp, which isn't unique across conversations (or hubs), and
  # delivery statuses are matched by external_id across all messages, so it's qualified by the conversation
  def self.message_external_id(conversation, timestamp)
    "#{conversation.id}:#{timestamp}"
  end

  def self.number_in_use?(phone_number, except_id: nil)
    where.not(id: except_id).any? { |integration| integration.get_credential(:phone_number) == phone_number }
  end

  def platform
    "signal"
  end

  # Users are identified by account id, which they can't see in the app, so an admin adds a trusted
  # end-user by phone number and the hub's own Signal account looks it up
  def self.end_user_id_for(hub, phone_number)
    integration = find_by(hub: hub, active: true)
    raise ExternalUser::UnresolvableIdentifier, I18n.t(:error_signal_not_connected) if integration.nil?

    account_id = SignalService.new(integration.get_credential(:phone_number)).find_account_id(phone_number)
    raise ExternalUser::UnresolvableIdentifier, I18n.t(:error_signal_user_not_found) if account_id.blank?

    account_id
  rescue SignalService::Error => e
    LogService.log(:error, "SignalMessagingIntegration", "Signal account lookup failed for hub #{hub.id}: #{e.message}")
    raise ExternalUser::UnresolvableIdentifier, I18n.t(:error_signal_lookup_failed)
  end

  def complete_link!
    phone_number = SignalService.new.finish_link(get_credential(:link_uri), DEVICE_NAME)
    # The admin may have cancelled while we waited; don't keep an account no hub uses
    unless self.class.exists?(id)
      SignalService.new(phone_number).delete_local_account_data if phone_number.present? && !self.class.number_in_use?(phone_number)
      return
    end

    # Numberless (username-only) accounts can't be routed, since incoming events identify the bot by number
    raise SignalService::Error, "linked account has no phone number" if phone_number.blank?

    set_credential(:phone_number, phone_number)
    set_credential(:link_uri, nil)
    set_setting(:link_status, "linked")
    self.active = true
    save!
  rescue SignalService::Error, ActiveRecord::RecordInvalid => e
    LogService.log(:error, "SignalMessagingIntegration", "Signal linking failed for integration #{id}: #{e.message}")
    reload.update_columns(settings: settings.merge("link_status" => "failed")) if self.class.exists?(id)
  end

  def as_json(options = {})
    extra = if get_credential(:phone_number).present?
      {"phone_number" => get_credential(:phone_number)}
    else
      {"signal_link" => {"uri" => get_credential(:link_uri), "status" => get_setting(:link_status)}}
    end
    super.merge(extra)
  end

  private

  def start_link!
    set_credential(:link_uri, SignalService.new.start_link)
    set_setting(:link_status, "pending")
  rescue SignalService::Error => e
    LogService.log(:error, "SignalMessagingIntegration", "Could not start Signal linking: #{e.message}")
    errors.add(:base, I18n.t(:error_signal_link_failed))
    raise ActiveRecord::RecordInvalid, self
  end

  def enqueue_link_completion
    SignalLinkWorker.perform_async(id)
  end

  def enqueue_account_data_deletion
    phone_number = get_credential(:phone_number)
    SignalAccountDeletionWorker.perform_async(phone_number) unless self.class.number_in_use?(phone_number)
  end

  # A number shared by two integrations would route one hub's incoming messages to the other
  def check_phone_number
    phone_number = get_credential(:phone_number)
    if phone_number.blank?
      errors.add(:base, I18n.t(:error_signal_phone_number_missing)) if active?
    elsif self.class.number_in_use?(phone_number, except_id: id)
      errors.add(:base, I18n.t(:error_signal_phone_number_taken))
    end
  end
end
