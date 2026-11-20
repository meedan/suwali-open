class AdminHubUpdateForm
  include ActiveModel::Model

  # Parses and validates the admin-only hub update params.
  # Only fields explicitly present in raw_params are included in attrs,
  # so callers can safely pass the result directly to hub.update.
  def initialize(raw_params)
    @raw = raw_params
  end

  # Returns the parsed, coerced attributes ready for hub.update.
  # Call valid? first.
  def attrs
    @attrs ||= {}
  end

  def valid?
    @attrs = {}
    @attrs[:plan] = @raw[:plan].to_s if @raw.key?(:plan)
    @attrs[:trial_emails_enabled] = ActiveModel::Type::Boolean.new.cast(@raw[:trial_emails_enabled]) if @raw.key?(:trial_emails_enabled)
    super
  end

  private

  validate :parse_trial_dates
  validate :parse_custom_limits

  def parse_trial_dates
    [:trial_started_at, :trial_ends_at].each do |field|
      next unless @raw.key?(field)
      raw_val = @raw[field]
      if raw_val.blank?
        @attrs[field] = nil
      else
        begin
          @attrs[field] = Date.strptime(raw_val.to_s, "%Y-%m-%d")
        rescue Date::Error
          errors.add(:base, I18n.t(:error_hub_invalid_date_format))
          next
        end
      end
    end
  end

  def parse_custom_limits
    return unless @raw.key?(:custom_limits)
    raw_limits = @raw[:custom_limits]
    if raw_limits.blank?
      @attrs[:custom_limits] = nil
      return
    end
    permitted = raw_limits.permit(:sources, :messages, :documents, :sms).to_h
    parsed = {}
    permitted.each do |key, val|
      if Hub::BOOLEAN_CUSTOM_LIMIT_KEYS.include?(key)
        parsed[key] = ActiveModel::Type::Boolean.new.cast(val)
      else
        unless val.to_s.match?(/\A\d+\z/)
          errors.add(:base, I18n.t(:error_hub_invalid_custom_limit, key: key))
          next
        end
        parsed[key] = val.to_i
      end
    end
    @attrs[:custom_limits] = parsed
  end
end
