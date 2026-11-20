require "httparty"

class WhatsappService
  include HTTParty

  PAIR_RATE_LIMIT_ERROR_CODE = 131056
  TEMPLATE_CATEGORY_MISMATCH_SUBCODE = 2388026

  class Error < StandardError
    attr_reader :code, :subcode, :details

    # `details` is Meta's human-readable reason, kept out of the message so it never reaches the logs
    def initialize(message, code = nil, subcode = nil, details = nil)
      super(message)
      @code = code
      @subcode = subcode
      @details = details
    end

    def template_category_mismatch?
      subcode == TEMPLATE_CATEGORY_MISMATCH_SUBCODE
    end
  end

  base_uri ENV.fetch("WHATSAPP_API_BASE", "https://graph.facebook.com")

  def initialize(logger = nil)
    @api_version = ENV.fetch("WHATSAPP_API_VERSION", "v21.0")
    @app_id = ENV.fetch("WHATSAPP_APP_ID")
    @app_secret = ENV.fetch("WHATSAPP_APP_SECRET")
    @logger = logger
  end

  def exchange_code_for_business_token(code)
    response = get("/#{@api_version}/oauth/access_token", query: {
      client_id: @app_id,
      client_secret: @app_secret,
      code: code
    })

    parsed = safe_parse(response)
    token = parsed["access_token"].to_s
    log("Token exchange response: code=#{response.code} token_type=#{parsed["token_type"]} expires_in=#{parsed["expires_in"]}")
    raise Error.new("Token exchange failed: #{safe_error_log(response)}") if token == ""
    token
  end

  def subscribe_waba(waba_id, business_token)
    response = post("/#{@api_version}/#{waba_id}/subscribed_apps", headers: auth_headers(business_token))
    log("WABA subscription response: #{response.body}")
    raise Error.new("WABA subscription failed: #{safe_error_log(response)}") unless response.success?
    true
  end

  def share_credit_line(waba_id, business_token)
    response = post("/#{@api_version}/#{waba_id}/assigned_users?user=#{ENV["WHATSAPP_SYSTEM_USER_ID"]}&tasks=['MANAGE_BILLING']&access_token=#{ENV["WHATSAPP_SYSTEM_TOKEN"]}")
    log("Sharing credit line: Adding system user to WABA response: #{response.body}")
    raise Error.new("Sharing credit line: Adding system user to WABA failed: #{safe_error_log(response)}") unless response.success?

    response = post("/#{@api_version}/#{ENV["WHATSAPP_CREDIT_LINE_ID"]}/whatsapp_credit_sharing_and_attach?waba_currency=USD&waba_id=#{waba_id}", headers: auth_headers(ENV["WHATSAPP_SYSTEM_TOKEN"]))
    log("Sharing credit line response: #{response.body}")
    raise Error.new("Sharing credit line failed: #{safe_error_log(response)}") unless response.success?

    # Another way:
    # response = get("/#{@api_version}/#{waba_id}",
    #   headers: auth_headers(business_token),
    #   query: {fields: "owner_business_info"})
    # log("Sharing credit line: Fetch business portfolio ID response: #{response.body}")
    # raise Error.new("Sharing credit line: Fetch business portfolio ID failed: #{response.body}") unless response.success?
    # parsed = safe_parse(response)
    # business_portfolio_id = parsed["owner_business_info"]["id"]

    # response = post("/#{@api_version}/#{ENV["WHATSAPP_CREDIT_LINE_ID"]}/whatsapp_credit_sharing?receiving_business_id=#{business_portfolio_id}", headers: auth_headers(ENV["WHATSAPP_SYSTEM_TOKEN"]))
    # log("Sharing credit line: Sharing credit line response: #{response.body}")
    # raise Error.new("Sharing credit line: Sharing credit line failed: #{response.body}") unless response.success?

    # response = post("/#{@api_version}/#{ENV["WHATSAPP_CREDIT_LINE_ID"]}/whatsapp_credit_attach?waba_currency=USD&waba_id=#{waba_id}", headers: auth_headers(business_token))
    # log("Sharing credit line: Attaching credit line response: #{response.body}")
    # raise Error.new("Sharing credit line: Attaching credit line failed: #{response.body}") unless response.success?
    true
  end

  def fetch_phone_number(phone_number_id, business_token)
    response = get("/#{@api_version}/#{phone_number_id}",
      headers: auth_headers(business_token),
      query: {fields: "display_phone_number"})

    parsed = safe_parse(response)
    log("Phone number fetching response: code=#{response.code}")
    raise Error.new("Fetch phone number failed: #{safe_error_log(response)}") unless response.success?
    parsed["display_phone_number"]
  end

  def fetch_phone_number_status(phone_number_id, business_token)
    response = get("/#{@api_version}/#{phone_number_id}",
      headers: auth_headers(business_token),
      query: {fields: "quality_rating,status,account_mode,name_status"})

    parsed = safe_parse(response)
    log("Phone number status fetching response: #{response.body}")
    raise Error.new("Fetch phone number status failed: #{safe_error_log(response)}") unless response.success?
    {
      quality_rating: parsed["quality_rating"],
      status: parsed["status"],
      account_mode: parsed["account_mode"],
      name_status: parsed["name_status"]
    }
  end

  def fetch_business_verification_status(waba_id, business_token)
    response = get("/#{@api_version}/#{waba_id}",
      headers: auth_headers(business_token),
      query: {fields: "business_verification_status"})

    parsed = safe_parse(response)
    log("Business verification status fetching response: #{response.body}")
    raise Error.new("Fetch business verification status failed: #{safe_error_log(response)}") unless response.success?
    parsed["business_verification_status"]&.upcase
  end

  def register_phone_number(phone_number_id, pin, business_token)
    body = {messaging_product: "whatsapp", pin: pin}
    response = post("/#{@api_version}/#{phone_number_id}/register",
      headers: auth_headers(business_token).merge("Content-Type" => "application/json"),
      body: body.to_json)
    log("Phone number registration response: #{response.body}")
    raise Error.new("Phone number registration failed: #{safe_error_log(response)}") unless response.success?
    true
  end

  def create_message_template(waba_id, business_token, name, language, category, components)
    body = {
      name: name,
      language: language,
      category: category,
      components: components
    }
    response = post("/#{@api_version}/#{waba_id}/message_templates",
      headers: auth_headers(business_token).merge("Content-Type" => "application/json"),
      body: body.to_json)
    log("Create message template response: #{response.body}")
    raise Error.new("Create message template failed: #{safe_error_log(response)}", error_code(response), error_subcode(response)) unless response.success?
    true
  end

  def fetch_message_templates(waba_id, business_token, name = nil)
    query = {fields: "name,language,status,category", limit: 500}
    query[:name] = name if name
    response = get("/#{@api_version}/#{waba_id}/message_templates",
      headers: auth_headers(business_token),
      query: query)

    parsed = safe_parse(response)
    log("Fetch message templates response: #{response.body}")
    raise Error.new("Fetch message templates failed: #{safe_error_log(response)}") unless response.success?
    parsed["data"].to_a
  end

  def send_message(phone_number_id, business_token, to, text)
    preview_url = text.match?(/https?:\/\//)
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "text",
      text: {
        preview_url: preview_url,
        body: text
      }
    }
    post_message(phone_number_id, business_token, to, body, "Send message")
  end

  def send_interactive_message(phone_number_id, business_token, to, text, button_data)
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: text.to_s.truncate(1024) # WhatsApp API hard limit
        },
        action: {
          buttons: [
            {
              type: "reply",
              reply: {
                id: button_data[:id],
                title: button_data[:title].to_s.truncate(20) # WhatsApp API hard limit
              }
            }
          ]
        }
      }
    }
    post_message(phone_number_id, business_token, to, body, "Send interactive message")
  end

  def send_typing_indicator(phone_number_id, business_token, message_id)
    body = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: message_id,
      typing_indicator: {type: "text"}
    }
    response = post("/#{@api_version}/#{phone_number_id}/messages",
      headers: auth_headers(business_token).merge("Content-Type" => "application/json"),
      body: body.to_json)
    log("Send typing indicator response: #{response.body}")
    raise Error.new("Send typing indicator failed: #{safe_error_log(response)}") unless response.success?
    true
  end

  def send_template_message(phone_number_id, business_token, to, name, language, parameters = [], button_payloads = [])
    components = []
    components << {type: "body", parameters: parameters.map { |text| {type: "text", text: text} }} if parameters.any?
    # Quick reply buttons require a payload, returned when the user taps the button
    button_payloads.each_with_index do |payload, index|
      components << {type: "button", sub_type: "quick_reply", index: index.to_s, parameters: [{type: "payload", payload: payload}]}
    end
    body = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      type: "template",
      template: {
        name: name,
        language: {code: language},
        components: components
      }
    }
    post_message(phone_number_id, business_token, to, body, "Send template message")
  end

  private

  def post_message(phone_number_id, business_token, to, body, label)
    response = post("/#{@api_version}/#{phone_number_id}/messages",
      headers: auth_headers(business_token).merge("Content-Type" => "application/json"),
      body: body.merge(recipient_params(to)).to_json)
    log("#{label} response: code=#{response.code} message_id=#{safe_parse(response)["messages"]&.first&.dig("id")}")
    raise Error.new("#{label} failed: #{safe_error_log(response)}", error_code(response), nil, error_details(response)) unless response.success?
    response
  end

  # BSUIDs have the format "XX.alphanumeric" (e.g., "US.1349120865530274"),
  # while phone numbers are purely numeric (with optional leading +).
  def bsuid?(identifier)
    identifier.to_s.match?(/\A[A-Z]{2}\./)
  end

  def recipient_params(identifier)
    if bsuid?(identifier)
      {recipient: identifier}
    else
      {to: identifier}
    end
  end

  def auth_headers(token)
    {"Authorization" => "Bearer #{token}"}
  end

  # A failure body is not always a Graph error object - it can be a bare string, or HTML from a proxy.
  def error_code(response)
    error_field(response, "code")
  end

  def error_subcode(response)
    error_field(response, "error_subcode")
  end

  def error_details(response)
    data = error_field(response, "error_data")
    (data["details"] if data.is_a?(Hash)) || error_field(response, "message")
  end

  def error_field(response, key)
    parsed = safe_parse(response)
    error = parsed.is_a?(Hash) ? parsed["error"] : nil
    error[key] if error.is_a?(Hash)
  end

  def safe_parse(response)
    JSON.parse(response.body)
  rescue
    {}
  end

  def safe_error_log(response)
    parsed = safe_parse(response)
    error = parsed.is_a?(Hash) ? parsed["error"] : nil
    return "code=#{response.code}" unless error.is_a?(Hash)

    details = %w[type code error_subcode fbtrace_id].filter_map { |key| "#{key}=#{error[key]}" if error[key] }
    "code=#{response.code} #{details.join(" ")}"
  end

  def post(endpoint, options = {})
    self.class.post(endpoint, options)
  end

  def get(endpoint, options = {})
    self.class.get(endpoint, options)
  end

  def log(message)
    @logger&.log(:info, "WhatsappService", message)
  end
end
