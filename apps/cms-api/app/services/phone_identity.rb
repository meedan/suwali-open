# Equivalent spellings of the same phone number, for platforms that identify an account by a number
# other than the one its owner would write down. Neither form is canonical, so callers match on all.
#
# A country belongs here only when both forms provably identify the same line. Argentina does not:
# it tells a landline and a mobile apart only by the 9, so matching across them would merge two
# different people.
module PhoneIdentity
  MATCHED_PLATFORMS = %w[whatsapp].freeze

  class << self
    def variants(external_id, platform)
      id = external_id.to_s
      return [id] unless MATCHED_PLATFORMS.include?(platform.to_s) && id.match?(/\A\d+\z/)

      ([id] + alternatives(id)).uniq
    end

    private

    def alternatives(digits)
      case digits
      when /\A55/ then brazil(digits[2..])
      when /\A52/ then mexico(digits[2..])
      else []
      end
    end

    # Only 6, 8 and 9 — an eight-digit subscriber starting with any of those is not an assignable
    # Brazilian number, so it can only be the legacy form of the nine-digit one. 2-5 is a landline
    # and 7 is still a live eight-digit mobile range: pairing either would merge two real people.
    def brazil(nsn)
      return [] unless nsn.match?(/\A[1-9]\d/)
      area = nsn[0, 2]
      subscriber = nsn[2..]
      return ["55#{area}#{subscriber[1..]}"] if subscriber.match?(/\A9[689]\d{7}\z/)
      return ["55#{area}9#{subscriber}"] if subscriber.match?(/\A[689]\d{7}\z/)
      []
    end

    # No guard needed: the "1" is a legacy marker rather than part of the number, so both forms are
    # always the same line.
    def mexico(nsn)
      return ["52#{nsn[1..]}"] if nsn.match?(/\A1\d{10}\z/)
      return ["521#{nsn}"] if nsn.match?(/\A\d{10}\z/)
      []
    end
  end
end
