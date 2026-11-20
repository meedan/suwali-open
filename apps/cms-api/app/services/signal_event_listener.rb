require "net/http"

# Long-running process (bin/start-signal-listener.sh) that reads signal-cli's Server-Sent Events
# stream, which covers every linked account, and hands each incoming event to SignalInboundWorker.
# signal-cli replays the events after the given Last-Event-ID, so nothing is lost while we reconnect.
class SignalEventListener
  # Raised to drop the connection: a plain break would make Net::HTTP read the rest of an endless stream
  class AccountsChanged < StandardError; end

  LAST_EVENT_ID_KEY = "signal_event_listener/last_event_id"
  RECONNECT_DELAY = 5
  # signal-cli sends a keep-alive every few seconds, so a longer silence means the connection is gone
  READ_TIMEOUT = 60
  # The stream only covers the accounts linked when it was opened, and signal-cli fetches a newly
  # linked account's messages right away, so they're lost until we reconnect: check often
  ACCOUNT_CHECK_INTERVAL = 5

  def run
    loop do
      stream
    rescue => e
      LogService.log(:warn, "SignalEventListener", "Signal event stream interrupted: #{e.message}")
    ensure
      sleep RECONNECT_DELAY
    end
  rescue SignalException
    # Stopped (e.g. on deploy): nothing to report, it resumes from the last event id when started again
    nil
  end

  private

  def stream
    uri = URI("#{ENV.fetch("SIGNAL_CLI_URL", "http://signal-cli:8080")}/api/v1/events")
    headers = {"Accept" => "text/event-stream", "Last-Event-ID" => Rails.cache.read(LAST_EVENT_ID_KEY)}.compact
    accounts = SignalService.new.list_accounts.sort
    checked_at = monotonic_now

    Net::HTTP.start(uri.host, uri.port, read_timeout: READ_TIMEOUT) do |http|
      http.request(Net::HTTP::Get.new(uri, headers)) do |response|
        raise "unexpected HTTP #{response.code}" unless response.is_a?(Net::HTTPSuccess)

        buffer = +""
        response.read_body do |chunk|
          buffer << chunk.delete("\r")
          while (boundary = buffer.index("\n\n"))
            handle_event(buffer.slice!(0, boundary + 2))
          end

          next if monotonic_now - checked_at < ACCOUNT_CHECK_INTERVAL
          checked_at = monotonic_now
          raise AccountsChanged if SignalService.new.list_accounts.sort != accounts
        end
      end
    end
  rescue AccountsChanged
    nil
  end

  def monotonic_now
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def handle_event(raw_event)
    fields = raw_event.lines.map(&:chomp).reject { |line| line.start_with?(":") }
      .group_by { |line| line.split(":", 2).first }
      .transform_values { |lines| lines.map { |line| line.split(":", 2).last.to_s.delete_prefix(" ") } }

    data = fields["data"].to_a.join("\n")
    SignalInboundWorker.perform_async(data) if fields["event"]&.first == "receive" && handled_event?(data)

    event_id = fields["id"]&.first
    Rails.cache.write(LAST_EVENT_ID_KEY, event_id) if event_id.present?
  end

  # Only messages and delivery receipts are handled (see WebhookServices::SignalService). Typing, read
  # receipts and activity on the linked phone would only add jobs carrying names and account ids.
  def handled_event?(data)
    envelope = JSON.parse(data)["envelope"].to_h
    envelope["dataMessage"].present? || envelope.dig("receiptMessage", "isDelivery") == true
  rescue JSON::ParserError
    false
  end
end
