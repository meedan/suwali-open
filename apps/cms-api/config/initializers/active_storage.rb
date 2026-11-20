# Serve plain-text documents inline so they can be previewed in an iframe.
# Both variants are listed because allowed_inline? matches the content type exactly.
Rails.application.config.active_storage.content_types_allowed_inline += ["text/plain", "text/plain; charset=utf-8"]

# Declare a charset for plain-text blobs so browsers don't have to guess the
# encoding when previewing uploaded TXT files. Without this, the proxied file is
# served as "text/plain" with no charset and the browser emits a "character
# encoding was not declared" warning.
ActiveSupport.on_load(:active_storage_blob) do
  before_save do
    self.content_type = "text/plain; charset=utf-8" if content_type == "text/plain"
  end
end
