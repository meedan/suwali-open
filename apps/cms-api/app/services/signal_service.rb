require "httparty"

# JSON-RPC client for our signal-cli daemon (services/signal-cli). Messaging calls act as one linked
# Signal account; linking a new account needs none.
class SignalService
  include HTTParty

  class Error < StandardError; end

  base_uri ENV.fetch("SIGNAL_CLI_URL", "http://signal-cli:8080")
  default_timeout 10

  # signal-cli gives up on a QR code that isn't scanned within 2 minutes; this only needs to outlast that
  LINK_TIMEOUT = 3.minutes.to_i
  # send only returns once Signal's server has accepted the message, which can take well over the
  # default; giving up sooner marks a message failed that is then delivered anyway
  SEND_TIMEOUT = 1.minute.to_i

  def initialize(account = nil)
    @account = account
  end

  # Returns the sent message's timestamp: receipts, reactions and quotes refer back to it.
  # text_style entries are "start:length:STYLE", counted in UTF-16 code units.
  def send_message(recipient:, message:, text_style: nil)
    rpc("send", {recipient: [recipient], message: message, textStyle: text_style}, timeout: SEND_TIMEOUT).fetch("timestamp")
  end

  # Shown for up to 15 seconds, or until a message is sent
  def send_typing(recipient:)
    rpc("sendTyping", {recipient: [recipient]})
  end

  def start_link
    rpc("startLink", {}).fetch("deviceLinkUri")
  end

  # Blocks until the QR code for link_uri is scanned (or expires), then returns the linked account's number
  def finish_link(link_uri, device_name)
    rpc("finishLink", {deviceLinkUri: link_uri, deviceName: device_name}, timeout: LINK_TIMEOUT)["number"]
  end

  def list_accounts
    rpc("listAccounts", {}).map { |account| account["number"] }
  end

  # The account id (UUID) of the Signal user with this phone number, or nil if there's none or they
  # don't allow being found by number
  def find_account_id(phone_number)
    rpc("getUserStatus", {recipient: [phone_number]}).first&.dig("uuid")
  end

  def delete_local_account_data
    rpc("deleteLocalAccountData", {ignoreRegistered: true})
  end

  private

  def rpc(method, params, timeout: nil)
    response = self.class.post("/api/v1/rpc", {
      body: {jsonrpc: "2.0", id: SecureRandom.uuid, method: method, params: params.merge(account: @account).compact}.to_json,
      headers: {"Content-Type" => "application/json"},
      timeout: timeout
    }.compact)
    raise Error, "signal-cli #{method} failed with HTTP #{response.code}: #{response.body}" unless response.success?
    raise Error, "signal-cli #{method} failed: #{response.dig("error", "message")}" if response["error"]

    response["result"]
  rescue HTTParty::Error, SocketError, SystemCallError, Timeout::Error => e
    raise Error, "signal-cli #{method} unreachable: #{e.class}"
  end
end
