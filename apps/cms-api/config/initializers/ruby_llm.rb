require "ruby_llm"
require "ruby_llm/schema"

RubyLLM.configure do |config|
  # Add keys ONLY for the providers you intend to use.
  # Using environment variables is highly recommended.
  config.openai_api_key = ENV.fetch("OPENAI_API_KEY", nil)
  # config.anthropic_api_key = ENV.fetch('ANTHROPIC_API_KEY', nil)
  config.default_model = ENV.fetch("LLM_MODEL", "gpt-5.4")
end
