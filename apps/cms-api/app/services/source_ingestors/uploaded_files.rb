require_relative "file_constraints"

module SourceIngestors
  class UploadedFiles
    include FileConstraints

    MAX_FILES_PER_UPLOAD = 5

    def call(config = {})
      files = Array(config[:files])
      validate!(files)

      documents_data = files.map { |file| document_data(file) }
      [documents_data, documents_data.size, I18n.t(:uploaded_files_source_default_title)]
    end

    private

    def validate!(files)
      errors = []
      if files.size > MAX_FILES_PER_UPLOAD
        errors << I18n.t(:error_uploaded_files_too_many, max: MAX_FILES_PER_UPLOAD)
      end
      files.each do |file|
        ext = File.extname(file.original_filename).delete(".").downcase
        unless ALLOWED_EXTENSIONS.include?(ext)
          errors << I18n.t(:error_uploaded_files_unsupported_type, filename: file.original_filename, allowed: ALLOWED_EXTENSIONS.join(", "))
        end
        if file.size > MAX_SIZE_BYTES
          errors << I18n.t(:error_uploaded_files_too_large, filename: file.original_filename, max_mb: MAX_SIZE_BYTES / 1024 / 1024)
        end
      end
      raise errors.join("; ") if errors.any?
    end

    def document_data(file)
      ext = File.extname(file.original_filename).delete(".").downcase
      document_type = EXTENSION_ALIASES.fetch(ext, ext)
      {
        external_id: SecureRandom.uuid,
        title: file.original_filename,
        document_type: document_type,
        content: (file.read.force_encoding("UTF-8").scrub if document_type == "md"),
        file: file
      }
    ensure
      file.rewind
    end
  end
end
