class LogService
  class Error < StandardError; end

  def self.log(level, context, message, logger = Rails.logger)
    span = defined?(Sentry) ? Sentry.get_current_scope&.get_span : nil
    trace_info = span ? " [trace=#{span.trace_id}] [span=#{span.span_id}]" : ""
    logger.public_send(level, "[#{level}] [#{Time.now}] [#{context}]#{trace_info} #{message}")
    Sentry.capture_exception(::LogService::Error.new(message), extra: {message: message, context: context}) if level.to_sym == :error && defined?(Sentry)
  end
end
