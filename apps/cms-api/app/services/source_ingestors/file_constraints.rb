module SourceIngestors
  module FileConstraints
    SUPPORTED_MIME_TYPES = {
      "application/pdf" => "pdf",
      "text/plain" => "txt",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
      "text/markdown" => "md"
    }.freeze

    EXTENSION_ALIASES = {
      "markdown" => "md"
    }.freeze

    ALLOWED_EXTENSIONS = (SUPPORTED_MIME_TYPES.values + EXTENSION_ALIASES.keys).freeze

    MAX_SIZE_BYTES = 5 * 1024 * 1024 # 5 MB
  end
end
