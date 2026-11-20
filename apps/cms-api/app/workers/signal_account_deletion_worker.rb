class SignalAccountDeletionWorker
  include Sidekiq::Worker
  sidekiq_options queue: :default, retry: 3

  def perform(phone_number)
    # The number may have been connected to a hub again since this was enqueued
    return if SignalMessagingIntegration.number_in_use?(phone_number)

    SignalService.new(phone_number).delete_local_account_data
  end
end
