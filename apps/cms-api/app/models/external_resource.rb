class ExternalResource < ApplicationRecord
  include TrialRestrictable
  include ScenarioMessageCacheable

  VALID_SCENARIOS = %w[role_description unanswerable_question error_occurred first_message speak_to_person purchase_subscribe conversation_closed].freeze
  RESOURCE_TYPES = %w[email phone link question].freeze
  MAX_DESCRIPTION_LENGTH = 500
  MAX_QUESTION_LENGTH = 200

  TITLE_CHECKS = {
    "link" => lambda do |title|
      uri = URI.parse(URI::RFC2396_PARSER.escape(title))
      uri.is_a?(URI::HTTP) && uri.host.present?
    rescue URI::InvalidURIError
      false
    end,
    "phone" => ->(title) { title.delete(" ().-").match?(/\A\+?\d{7,15}\z/) },
    "email" => ->(title) { URI::MailTo::EMAIL_REGEXP.match?(title) }
  }.freeze

  belongs_to :hub

  before_validation :clean_up_scenarios
  validates :title, presence: true
  validates :resource_type, inclusion: {in: RESOURCE_TYPES}, allow_nil: true
  validates :description, length: {maximum: MAX_DESCRIPTION_LENGTH}
  validate :scenarios_must_not_be_empty
  validate :scenarios_must_be_valid
  validates :title, length: {maximum: MAX_QUESTION_LENGTH}, if: -> { resource_type == "question" }
  validate :title_must_fit_resource_type

  # The type a title looks like (link, phone, or email), or nil when it looks like none of them
  def self.detect_type(title)
    TITLE_CHECKS.find { |_type, check| check.call(title.to_s.strip) }&.first
  end

  def as_json(options = {})
    {
      id: id,
      title: title,
      resource_type: resource_type,
      scenarios: scenarios,
      description: description,
      created_at: created_at,
      updated_at: updated_at
    }
  end

  private

  def clean_up_scenarios
    self.scenarios = scenarios.to_a.reject { |scenario| scenario.blank? }
  end

  def scenarios_must_not_be_empty
    errors.add(:base, I18n.t(:error_scenarios_empty)) if scenarios.blank?
  end

  def scenarios_must_be_valid
    return if scenarios.blank?

    invalid_scenarios = scenarios.to_a - VALID_SCENARIOS
    errors.add(:base, I18n.t(:error_scenarios_invalid)) if invalid_scenarios.any?
  end

  # Untyped resources were saved before the type existed, and keep saving as they are
  def title_must_fit_resource_type
    check = TITLE_CHECKS[resource_type]
    return if title.blank? || check.nil? || check.call(title.strip)

    errors.add(:base, I18n.t(:"error_resource_#{resource_type}_invalid"))
  end
end
