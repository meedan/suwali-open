require "google/apis/drive_v3"
require "googleauth"
require "tempfile"
require_relative "file_constraints"

module SourceIngestors
  class GoogleDriveFolder
    include FileConstraints

    Drive = Google::Apis::DriveV3

    PREVIEW_LIMIT = 5

    # Google Workspace files need export_file (not get_file) and have no file extension or reported size.
    GOOGLE_WORKSPACE_EXPORT_MAP = {
      "application/vnd.google-apps.document" => {export_mime: "application/pdf", extension: ".pdf", document_type: "pdf"}
    }.freeze
    SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut".freeze
    FOLDER_MIME_TYPE = "application/vnd.google-apps.folder".freeze
    CONFIG_FILE_PATH = "config/credentials.json"

    def self.share_email
      ENV["GOOGLE_DRIVE_SHARE_EMAIL"]
    end

    def initialize(config = {})
      @folder_url = config["folder_url"]
      @folder_id = extract_google_drive_folder_id
      return unless @folder_id

      ENV["GOOGLE_APPLICATION_CREDENTIALS"] = CONFIG_FILE_PATH
      ensure_aws_env_credentials_from_ecs! if Rails.env.production?
      scopes = ["https://www.googleapis.com/auth/drive.readonly"]
      credentials = Google::Auth.get_application_default(scopes)
      @drive = Drive::DriveService.new
      @drive.authorization = credentials
    end

    def call(existing_documents_scope: nil, deleted_documents_scope: nil)
      return [[], nil, nil, [], nil] unless @folder_id

      @existing_docs_scope = existing_documents_scope
      @deleted_docs_scope = deleted_documents_scope

      run_ingestion
    end

    def preview
      return [[], nil, nil, [], nil] unless @folder_id

      @limit = PREVIEW_LIMIT
      run_ingestion(strict: true)
    end

    def as_file(doc_data)
      drive = doc_data[:google_drive_drive_object]
      file = doc_data[:google_drive_file_object]
      export_config = GOOGLE_WORKSPACE_EXPORT_MAP[file.mime_type]

      if export_config
        tempfile = Tempfile.new(["google_drive_file_", export_config[:extension]], binmode: true)
        drive.export_file(file.id, export_config[:export_mime], download_dest: tempfile)
      else
        tempfile = Tempfile.new(["google_drive_file_", File.extname(file.name)], binmode: true)
        drive.get_file(file.id, download_dest: tempfile, supports_all_drives: true)
      end

      tempfile.rewind
      tempfile.path
    end

    def refresh_supported?
      true
    end

    def full_sync?
      true
    end

    def refetch_document_data(data)
      file = @drive.get_file(data[:external_id], fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
      raise "File #{file.id} is no longer a supported type (#{file.mime_type})" unless supported?(file)

      extract_document_data(file, strict: false)
    end

    private

    # A Drive shortcut is its own entry (mime_type "application/vnd.google-apps.shortcut") and its
    # name mirrors the target, so it slips past the extension filter but has no usable document_type.
    # Replace each shortcut with its target file so the rest of the pipeline operates on the real file.
    def resolve_shortcuts(files)
      files.filter_map do |file|
        next file unless file.mime_type == SHORTCUT_MIME_TYPE

        target_id = file.shortcut_details&.target_id
        next nil unless target_id

        @drive.get_file(target_id, fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
      rescue Google::Apis::Error => e
        # Target lives outside the shared folder and isn't shared with the service account.
        LogService.log(:warn, "GoogleDriveFolder", "Skipping shortcut #{file.id}: target not accessible (#{e.message})")
        record_error(file, :shortcut_target_inaccessible)
        nil
      end
    end

    def run_ingestion(strict: false)
      @errors = []
      query = "'#{@folder_id}' in parents and trashed = false"
      files = @drive.list_files(
        q: query,
        fields: "files(id, name, mime_type, created_time, modified_time, web_view_link, shortcut_details(target_id))",
        supports_all_drives: true,
        include_items_from_all_drives: true
      ).files
      files = resolve_shortcuts(files)

      folders, candidate_files = files.partition { |file| file.mime_type == FOLDER_MIME_TYPE }
      folders.each { |folder| record_error(folder, :folder_not_supported) }
      supported_files = candidate_files.select { |file| supported?(file) }
      (candidate_files - supported_files).each { |file| record_error(file, :unsupported_type, file.mime_type) }

      total = supported_files.size

      new_files = supported_files.reject { |file| already_ingested?(file) }
      within_limit = new_files.select { |file| within_size_limit?(file) }
      (new_files - within_limit).each { |file| record_error(file, :file_too_large) }

      within_limit = within_limit.first(@limit) if @limit
      documents = within_limit.map { |file| extract_document_data(file, strict: strict) }

      suggested_name = begin
        @drive.get_file(@folder_id, fields: "name", supports_all_drives: true).name.presence || @folder_url
      rescue
        @folder_url
      end

      [documents, total, suggested_name, @errors, nil]
    end

    def supported?(file)
      GOOGLE_WORKSPACE_EXPORT_MAP.key?(file.mime_type) ||
        ALLOWED_EXTENSIONS.any? { |ext| file.name.downcase.end_with?(".#{ext}") }
    end

    def already_ingested?(file)
      @existing_docs_scope&.exists?(external_id: file.id) || @deleted_docs_scope&.exists?(external_id: file.id)
    end

    def within_size_limit?(file)
      # Google Workspace files don't report a size
      GOOGLE_WORKSPACE_EXPORT_MAP.key?(file.mime_type) ||
        @drive.get_file(file.id, fields: "size", supports_all_drives: true).size.to_i <= MAX_SIZE_BYTES
    end

    def record_error(file, reason, details = nil)
      @errors << {
        external_id: file.id,
        title: file.name,
        link: file.web_view_link,
        reason: reason.to_s,
        details: details
      }
    end

    def extract_document_data(file, strict: false)
      document = {
        external_id: file.id,
        title: file.name,
        content: nil,
        link: file.web_view_link,
        date: file.created_time,
        metadata: {
          drive_url: file.web_view_link,
          modified_time: file.modified_time
        },
        document_type: GOOGLE_WORKSPACE_EXPORT_MAP.dig(file.mime_type, :document_type) || SUPPORTED_MIME_TYPES[file.mime_type]
      }

      unless strict
        document[:google_drive_drive_object] = @drive
        document[:google_drive_file_object] = file
      end

      document
    end

    def extract_google_drive_folder_id
      match = @folder_url.to_s.match(
        %r{
          (?:/folders/|open\?id=) # Match either "/folders/" or "open?id="
          (?<id>[a-zA-Z0-9_-]+)   # Capture the folder ID
        }x
      )
      match[:id] if match
    end

    def ensure_aws_env_credentials_from_ecs!
      host = "169.254.170.2".freeze
      uri_env = "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI".freeze

      relative_uri = ENV[uri_env]
      return unless relative_uri # not running on ECS/Fargate or task role not injected

      uri = URI::HTTP.build(host: host, path: relative_uri)
      res = Net::HTTP.get_response(uri)

      unless res.is_a?(Net::HTTPSuccess)
        raise "Failed to fetch ECS task credentials (#{res.code}): #{res.body}"
      end

      creds = JSON.parse(res.body)

      ENV["AWS_ACCESS_KEY_ID"] = creds.fetch("AccessKeyId")
      ENV["AWS_SECRET_ACCESS_KEY"] = creds.fetch("SecretAccessKey")
      ENV["AWS_SESSION_TOKEN"] = creds.fetch("Token")
    end
  end
end
