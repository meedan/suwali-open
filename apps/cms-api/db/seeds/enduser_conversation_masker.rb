require "base64"
require "securerandom"
require "yaml"

class EnduserConversationMasker
  # Fake people are named after rock stars, but always as a mashup of two different artists
  # (Bruce McCartney, John Dickinson). Generating names here rather than with Faker keeps the
  # masker usable under RAILS_ENV=production, where the :development, :test gem group — and so
  # Faker — is not loaded, which is exactly how the export runs on staging.
  ROCK_STARS = [
    ["John", "Lennon"], ["Paul", "McCartney"], ["George", "Harrison"], ["Ringo", "Starr"],
    ["Mick", "Jagger"], ["Keith", "Richards"], ["Freddie", "Mercury"], ["Brian", "May"],
    ["David", "Bowie"], ["Robert", "Plant"], ["Jimmy", "Page"], ["Bruce", "Springsteen"],
    ["Bruce", "Dickinson"], ["Ozzy", "Osbourne"], ["Kurt", "Cobain"], ["Axl", "Rose"],
    ["Janis", "Joplin"], ["Stevie", "Nicks"], ["Joan", "Jett"], ["Patti", "Smith"],
    ["Chrissie", "Hynde"], ["Debbie", "Harry"], ["Tina", "Turner"], ["Jimi", "Hendrix"],
    ["Lou", "Reed"], ["Iggy", "Pop"], ["Neil", "Young"], ["Angus", "Young"],
    ["Roger", "Waters"], ["Pete", "Townshend"], ["Steven", "Tyler"], ["Jim", "Morrison"],
    ["Eric", "Clapton"], ["Tom", "Petty"], ["Dave", "Grohl"], ["Thom", "Yorke"],
    ["Grace", "Slick"], ["Kim", "Gordon"], ["Alice", "Cooper"], ["Carlos", "Santana"],
    ["Kate", "Bush"], ["Courtney", "Love"], ["Billy", "Corgan"], ["Eddie", "Vedder"],
    ["Chris", "Cornell"], ["James", "Hetfield"], ["Tony", "Iommi"], ["David", "Gilmour"],
    ["Peter", "Gabriel"], ["Joe", "Strummer"], ["Siouxsie", "Sioux"]
  ].freeze

  FAKE_PHONE_PREFIX = "1555"
  FAKE_USER_ID_PREFIX = "XX."
  REAL_MEDIA_HOST = "lookaside.fbsbx.com"

  def initialize
    @used_names = []
  end

  def mask(data)
    eu_lookup = {}
    conv_lookup = {}

    masked_external_users = data["external_users"].map do |eu|
      fake = build_fake(eu["platform"])
      eu_lookup[eu["id"]] = fake
      replace_anonymized(eu, fake[:external_user])
    end

    masked_conversations = data["conversations"].map do |conv|
      fake = eu_lookup[conv["participant_id"]]
      conv_lookup[conv["id"]] = fake
      replace_anonymized(conv, fake[:conversation])
    end

    masked_messages = data["messages"].each_with_index.map do |msg, index|
      fake = conv_lookup[msg["conversation_id"]]
      row = replace_anonymized(msg, fake[:message])
      row["external_id"] = fake_external_id(fake, index) if row["external_id"] == "[ANONYMIZED]"
      row
    end

    data.merge("external_users" => masked_external_users, "conversations" => masked_conversations, "messages" => masked_messages)
  end

  class << self
    def leaks(snapshot)
      found = snapshot["messages"].to_a.flat_map { |row| message_leaks(row) }
      found << REAL_MEDIA_HOST if media_host_in?(snapshot)
      found.uniq
    end

    private

    def message_leaks(row)
      found = phone_numbers_recoverable_from(row["external_id"].to_s)

      from_user_id = row["payload"].is_a?(Hash) ? row["payload"]["from_user_id"] : nil
      found << from_user_id unless from_user_id.nil? || from_user_id.to_s.start_with?(FAKE_USER_ID_PREFIX)

      found
    end

    def media_host_in?(node)
      case node
      when Hash then node.any? { |_, value| media_host_in?(value) }
      when Array then node.any? { |value| media_host_in?(value) }
      when String then node.include?(REAL_MEDIA_HOST)
      else false
      end
    end

    def phone_numbers_recoverable_from(external_id)
      return [] unless external_id.start_with?("wamid.")

      Base64.decode64(external_id.delete_prefix("wamid."))
        .scan(/\d{10,15}/)
        .reject { |digits| digits.start_with?(FAKE_PHONE_PREFIX) }
    end
  end

  private

  def build_fake(platform)
    first_name, last_name = fake_name_parts
    fake_name = "#{first_name} #{last_name}"
    username = fake_username(fake_name)

    phone_number = fake_phone_number.delete_prefix("+")
    fake_id = (platform == "whatsapp") ? phone_number : username

    from_telegram = {
      "id" => fake_id,
      "username" => username,
      "last_name" => last_name,
      "first_name" => first_name
    }
    from = (platform == "whatsapp") ? phone_number : from_telegram

    {
      platform: platform,
      phone_number: phone_number,
      external_user: {"external_id" => fake_id, "display_name" => fake_name, "metadata" => {}},
      conversation: {"title" => fake_name, "context" => []},
      message: {"payload" => {
        "id" => fake_id,
        "from" => from,
        "from_user_id" => "#{FAKE_USER_ID_PREFIX}#{rand(1_000_000_000_000_000..9_999_999_999_999_999)}",
        "chat" => {"id" => fake_id, "first_name" => first_name, "last_name" => last_name, "username" => username},
        "context" => {"id" => fake_id, "from" => fake_name},
        "message" => {
          "chat" => {"id" => fake_id, "first_name" => first_name, "last_name" => last_name, "username" => username},
          "from" => nil
        },
        "chat_instance" => "-#{rand(1_000_000_000_000_000_000..9_999_999_999_999_999_999)}",
        "image" => nil,
        "reply_to_message" => nil,
        "forward_from" => nil,
        "contact" => nil
      }.merge(twilio_form_fields(phone_number, fake_name))}
    }
  end

  def twilio_form_fields(phone_number, name)
    {
      "From" => phone_number,
      "To" => fake_phone_number.delete_prefix("+"),
      "ProfileName" => name,
      "FromCity" => "SPRINGFIELD",
      "FromState" => "NY",
      "FromZip" => "10001",
      "FromCountry" => "US",
      "AccountSid" => "AC#{SecureRandom.hex(16)}"
    }
  end

  def fake_external_id(fake, index)
    return (index + 1).to_s unless fake[:platform] == "whatsapp"

    "wamid.#{Base64.strict_encode64("#{fake[:phone_number]}-#{index}")}"
  end

  # Draws the surname from an artist who shares neither name with the one the first name came from,
  # so the result is never a real musician (no "Neil Young", no "Bruce Dickinson"). Names already
  # handed out are skipped so no two people in a snapshot end up identical.
  def fake_name_parts
    star = ROCK_STARS.sample
    candidates = ROCK_STARS.reject { |other| other[0] == star[0] || other[1] == star[1] }
    unused = candidates.reject { |other| @used_names.include?("#{star[0]} #{other[1]}") }
    last_name = (unused.empty? ? candidates : unused).sample[1]

    @used_names << "#{star[0]} #{last_name}"
    [star[0], last_name]
  end

  def fake_username(name)
    "#{name.downcase.strip.gsub(/[^a-z]+/, "_")}#{rand(10..99)}"
  end

  def fake_phone_number
    "+#{FAKE_PHONE_PREFIX}#{rand(1_000_000..9_999_999)}"
  end

  def replace_anonymized(hash, overrides)
    overrides.each_with_object(hash.dup) do |(key, value), result|
      if value.is_a?(Hash) && result[key].is_a?(Hash)
        result[key] = replace_anonymized(result[key], value)
      elsif result[key] == "[ANONYMIZED]"
        result[key] = value
      end
    end
  end
end
