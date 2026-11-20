SUPPORTED_LANGUAGES = {
  "en" => "English",
  "ar" => "العربية",
  "es" => "Español",
  "fr" => "Français",
  "hi" => "हिन्दी",
  "pt" => "Português"
}.freeze

Rails.application.config.i18n.available_locales = SUPPORTED_LANGUAGES.keys.map(&:to_sym)
