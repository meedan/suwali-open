require "google/apis/drive_v3"
require "googleauth"
require "tempfile"
require_relative "../../unit_spec_helper"
require_relative "../../../app/services/log_service"
require_relative "../../../app/services/source_ingestors/google_drive_folder"
require_relative "shared_examples_for_file_constraints"

RSpec.describe SourceIngestors::GoogleDriveFolder do
  let(:drive_service) { instance_double(Google::Apis::DriveV3::DriveService) }
  let(:drive_authorization) { instance_double(Google::Auth::ServiceAccountCredentials) }
  let(:config) do
    {
      "folder_url" => "https://drive.google.com/drive/u/1/folders/123456_aBc"
    }
  end

  let(:file1) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file1",
      name: "report.pdf",
      mime_type: "application/pdf",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/file1/view"
    )
  end

  let(:file2) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file2",
      name: "note.txt",
      mime_type: "text/plain",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/file2/view"
    )
  end

  let(:file3) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file3",
      name: "ignored.exe",
      mime_type: "application/octet-stream",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/file3/view"
    )
  end

  let(:file4) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file4",
      name: "document.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/file4/view"
    )
  end

  let(:file5) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file5",
      name: "legacy.doc",
      mime_type: "application/msword",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/file5/view"
    )
  end

  let(:file6) do
    instance_double(
      Google::Apis::DriveV3::File,
      id: "file6",
      name: "My Google Doc",
      mime_type: "application/vnd.google-apps.document",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://docs.google.com/document/d/file6/edit"
    )
  end

  before do
    # Stub Rails to prevent errors in unit tests
    rails_env = double("Rails.env", production?: false)
    stub_const("Rails", double("Rails", env: rails_env, logger: Logger.new(IO::NULL)))

    allow(Google::Apis::DriveV3::DriveService).to receive(:new).and_return(drive_service)
    allow(Google::Auth).to receive(:get_application_default).and_return(drive_authorization)

    allow(drive_service).to receive(:authorization=)
    allow(drive_service).to receive(:authorization).and_return(drive_authorization)
    allow(drive_service).to receive(:list_files).and_return(double(files: [file1, file2, file3, file4, file5, file6]))
    allow(drive_service).to receive(:get_file).with("file1", fields: "size", supports_all_drives: true).and_return(double(size: 15 * 1024 * 1024)) # Too big
    allow(drive_service).to receive(:get_file).with("123456_aBc", fields: "name", supports_all_drives: true).and_return(double(name: "My Folder"))
    allow(drive_service).to receive(:get_file).with("file2", fields: "size", supports_all_drives: true).and_return(double(size: 1024))             # Allowed
    allow(drive_service).to receive(:get_file).with("file3", fields: "size", supports_all_drives: true).and_return(double(size: 1024))             # Disallowed extension
    allow(drive_service).to receive(:get_file).with("file4", fields: "size", supports_all_drives: true).and_return(double(size: 2048))             # Allowed .docx
    allow(drive_service).to receive(:get_file).with("file5", fields: "size", supports_all_drives: true).and_return(double(size: 2048))             # Disallowed .doc
    # file6 is a Google Workspace file — no size check, uses export_file instead of get_file
    allow(drive_service).to receive(:get_file).with("file2", hash_including(:download_dest))
    allow(drive_service).to receive(:get_file).with("file4", hash_including(:download_dest))
    allow(drive_service).to receive(:get_file).with("file5", hash_including(:download_dest))
    allow(drive_service).to receive(:export_file).with("file6", "application/pdf", hash_including(:download_dest))
  end

  def ingest_supported_file(mime_type:, extension:)
    file = instance_double(
      Google::Apis::DriveV3::File,
      id: "shared_example_file",
      name: "file.#{extension}",
      mime_type: mime_type,
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/file/d/shared_example_file/view"
    )
    allow(drive_service).to receive(:list_files).and_return(double(files: [file]))
    allow(drive_service).to receive(:get_file).with("shared_example_file", fields: "size", supports_all_drives: true).and_return(double(size: 1024))

    documents, _ = described_class.new(config).call

    documents.first&.dig(:document_type)
  end

  it_behaves_like "a FileConstraints ingestor"

  it "emits the file's created_time as the document date" do
    created_time = "2025-06-01T12:00:00Z"
    file = instance_double(
      Google::Apis::DriveV3::File,
      id: "dated_file",
      name: "dated.txt",
      mime_type: "text/plain",
      modified_time: Time.now.iso8601,
      created_time: created_time,
      web_view_link: "https://drive.google.com/file/d/dated_file/view"
    )
    allow(drive_service).to receive(:list_files).and_return(double(files: [file]))
    allow(drive_service).to receive(:get_file).with("dated_file", fields: "size", supports_all_drives: true).and_return(double(size: 1024))

    documents, _ = described_class.new(config).call

    expect(documents.first[:date]).to eq(created_time)
  end

  describe "#preview" do
    it "returns at most PREVIEW_LIMIT documents" do
      many_files = (1..6).map do |i|
        instance_double(
          Google::Apis::DriveV3::File,
          id: "extra_file_#{i}",
          name: "doc#{i}.txt",
          mime_type: "text/plain",
          modified_time: Time.now.iso8601,
          created_time: Time.now.iso8601,
          web_view_link: "https://drive.google.com/file/d/extra_file_#{i}/view"
        )
      end
      many_files.each do |f|
        allow(drive_service).to receive(:get_file).with(f.id, fields: "size", supports_all_drives: true).and_return(double(size: 1024))
      end
      allow(drive_service).to receive(:list_files).and_return(double(files: many_files))

      ingestor = described_class.new(config)
      documents, _ = ingestor.preview

      expect(documents.size).to eq(described_class::PREVIEW_LIMIT)
    end

    it "does not include drive objects in documents" do
      ingestor = described_class.new(config)
      documents, _ = ingestor.preview

      expect(documents).to all(satisfy { |doc|
        !doc.key?(:google_drive_drive_object) && !doc.key?(:google_drive_file_object)
      })
    end
  end

  it "ingests and returns data for allowed files" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    expect(result.size).to eq(3)
    ids = result.map { |r| r[:external_id] }
    expect(ids).to contain_exactly("file2", "file4", "file6")
  end

  it "returns a valid local path that points to a tempfile" do
    ingestor = described_class.new(config)
    documents, _ = ingestor.call
    txt_doc = documents.find { |d| d[:external_id] == "file2" }
    file_path = ingestor.as_file(txt_doc)

    expect(File.exist?(file_path)).to be(true)
  ensure
    File.delete(file_path) if file_path && File.exist?(file_path)
  end

  it "sets correct document_type for each format" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    types_by_id = result.each_with_object({}) { |r, h| h[r[:external_id]] = r[:document_type] }
    expect(types_by_id["file2"]).to eq("txt")
    expect(types_by_id["file4"]).to eq("docx")
    expect(types_by_id["file6"]).to eq("pdf") # Google Docs exported as PDF
  end

  it "exports Google Docs as PDF via export_file" do
    ingestor = described_class.new(config)
    documents, _ = ingestor.call
    google_doc = documents.find { |d| d[:external_id] == "file6" }
    ingestor.as_file(google_doc)

    expect(drive_service).to have_received(:export_file).with("file6", "application/pdf", hash_including(:download_dest))
  end

  it "downloads regular files via get_file" do
    ingestor = described_class.new(config)
    documents, _ = ingestor.call
    docx_doc = documents.find { |d| d[:external_id] == "file4" }
    ingestor.as_file(docx_doc)

    expect(drive_service).to have_received(:get_file).with("file4", hash_including(:download_dest))
  end

  it "skips files with disallowed extensions" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    ids = result.map { |r| r[:external_id] }
    expect(ids).not_to include("file3")
  end

  it "skips files larger than max size" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    ids = result.map { |r| r[:external_id] }
    expect(ids).not_to include("file1")
  end

  it "skips size check for Google Workspace files" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    ids = result.map { |r| r[:external_id] }
    expect(ids).to include("file6")
    expect(drive_service).not_to have_received(:get_file).with("file6", fields: "size", supports_all_drives: true)
  end

  it "includes Google Docs even though they have no file extension" do
    ingestor = described_class.new(config)
    result, _ = ingestor.call

    google_doc = result.find { |r| r[:external_id] == "file6" }
    expect(google_doc[:title]).to eq("My Google Doc")
  end

  it "returns the folder name as the suggested name when available" do
    folder = instance_double(Google::Apis::DriveV3::File, name: "My Project Docs")
    allow(drive_service).to receive(:get_file).with("123456_aBc", fields: "name", supports_all_drives: true).and_return(folder)

    ingestor = described_class.new(config)
    _, _, suggested_name = ingestor.call

    expect(suggested_name).to eq("My Project Docs")
  end

  it "returns the folder URL as the suggested name when the folder name cannot be retrieved" do
    allow(drive_service).to receive(:get_file).with("123456_aBc", fields: "name", supports_all_drives: true).and_raise(Google::Apis::AuthorizationError.new("Forbidden"))

    ingestor = described_class.new(config)
    _, _, suggested_name = ingestor.call

    expect(suggested_name).to eq("https://drive.google.com/drive/u/1/folders/123456_aBc")
  end

  it "returns total as count of supported files, regardless of how many are already imported" do
    existing_docs_scope = double("existing_docs_scope")
    allow(existing_docs_scope).to receive(:exists?).and_return(false)
    allow(existing_docs_scope).to receive(:exists?).with(external_id: "file2").and_return(true)
    deleted_docs_scope = double("deleted_docs_scope")
    allow(deleted_docs_scope).to receive(:exists?).and_return(false)

    ingestor = described_class.new(config)
    documents, total = ingestor.call(
      existing_documents_scope: existing_docs_scope,
      deleted_documents_scope: deleted_docs_scope
    )

    # file1 (pdf), file2 (txt), file4 (docx), file6 (Google Doc) are supported — total = 4
    expect(total).to eq(4)
    # file2 already imported, file1 too large — only file4 and file6 returned
    expect(documents.map { |d| d[:external_id] }).to contain_exactly("file4", "file6")
  end

  context "with a Drive shortcut" do
    let(:shortcut_target) do
      instance_double(
        Google::Apis::DriveV3::File,
        id: "target7",
        name: "linked.txt",
        mime_type: "text/plain",
        modified_time: Time.now.iso8601,
        created_time: Time.now.iso8601,
        web_view_link: "https://drive.google.com/file/d/target7/view"
      )
    end

    let(:shortcut) do
      instance_double(
        Google::Apis::DriveV3::File,
        id: "shortcut7",
        name: "linked.txt",
        web_view_link: "https://drive.google.com/file/d/shortcut7/view",
        mime_type: described_class::SHORTCUT_MIME_TYPE,
        shortcut_details: double(target_id: "target7")
      )
    end

    before do
      allow(drive_service).to receive(:list_files).and_return(double(files: [shortcut]))
      allow(drive_service).to receive(:get_file)
        .with("target7", fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
        .and_return(shortcut_target)
      allow(drive_service).to receive(:get_file).with("target7", fields: "size", supports_all_drives: true).and_return(double(size: 1024))
    end

    it "resolves the shortcut to its target file" do
      ingestor = described_class.new(config)
      result, total = ingestor.call

      expect(total).to eq(1)
      expect(result.size).to eq(1)
      doc = result.first
      expect(doc[:external_id]).to eq("target7")
      expect(doc[:title]).to eq("linked.txt")
      expect(doc[:document_type]).to eq("txt")
    end

    it "skips a shortcut whose target is not accessible to the service account" do
      allow(drive_service).to receive(:get_file)
        .with("target7", fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
        .and_raise(Google::Apis::ClientError.new("File not found", status_code: 404))

      ingestor = described_class.new(config)
      result, total, _, errors = ingestor.call

      expect(result).to be_empty
      expect(total).to eq(0)
      expect(errors.size).to eq(1)
      expect(errors.first[:external_id]).to eq("shortcut7")
      expect(errors.first[:reason]).to eq("shortcut_target_inaccessible")
    end
  end

  describe "#refresh_supported?" do
    it "returns true" do
      ingestor = described_class.new(config)

      expect(ingestor.refresh_supported?).to be(true)
    end
  end

  describe "#full_sync?" do
    it "returns true" do
      ingestor = described_class.new(config)

      expect(ingestor.full_sync?).to be(true)
    end
  end

  describe "#refetch_document_data" do
    it "returns fresh metadata via a live get_file lookup by the document's external_id" do
      updated_file2 = instance_double(
        Google::Apis::DriveV3::File,
        id: "file2",
        name: "note.txt",
        mime_type: "text/plain",
        modified_time: "2026-01-01T00:00:00Z",
        created_time: "2025-06-01T12:00:00Z",
        web_view_link: "https://drive.google.com/file/d/file2/view"
      )
      allow(drive_service).to receive(:get_file)
        .with("file2", fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
        .and_return(updated_file2)
      data = {external_id: "file2"}

      ingestor = described_class.new(config)
      doc_data = ingestor.refetch_document_data(data)

      expect(doc_data[:title]).to eq("note.txt")
      expect(doc_data[:metadata][:modified_time]).to eq("2026-01-01T00:00:00Z")
      expect(doc_data[:date]).to eq("2025-06-01T12:00:00Z")
      expect(doc_data[:google_drive_drive_object]).to eq(drive_service)
      expect(doc_data[:google_drive_file_object]).to eq(updated_file2)
    end

    it "propagates the error when the Drive file is no longer accessible" do
      allow(drive_service).to receive(:get_file)
        .with("file2", fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
        .and_raise(Google::Apis::ClientError.new("File not found", status_code: 404))
      data = {external_id: "file2"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(Google::Apis::ClientError)
    end

    it "raises when the file's mime type is no longer supported" do
      unsupported_file = instance_double(
        Google::Apis::DriveV3::File,
        id: "file3",
        name: "ignored.exe",
        mime_type: "application/octet-stream",
        modified_time: Time.now.iso8601,
        created_time: Time.now.iso8601,
        web_view_link: "https://drive.google.com/file/d/file3/view"
      )
      allow(drive_service).to receive(:get_file)
        .with("file3", fields: "id, name, mime_type, created_time, modified_time, web_view_link", supports_all_drives: true)
        .and_return(unsupported_file)
      data = {external_id: "file3"}

      ingestor = described_class.new(config)

      expect { ingestor.refetch_document_data(data) }.to raise_error(/no longer a supported type/)
    end
  end

  it "reports unsupported and oversized files as errors" do
    ingestor = described_class.new(config)
    _, _, _, errors = ingestor.call

    by_id = errors.index_by { |e| e[:external_id] }
    expect(by_id.keys).to contain_exactly("file1", "file3", "file5")
    expect(by_id["file1"][:reason]).to eq("file_too_large")
    expect(by_id["file3"][:reason]).to eq("unsupported_type")
    expect(by_id["file3"][:details]).to eq("application/octet-stream")
    expect(by_id["file5"][:reason]).to eq("unsupported_type")
  end

  it "reports subfolders as errors without ingesting them" do
    subfolder = instance_double(
      Google::Apis::DriveV3::File,
      id: "subfolder1",
      name: "Archive",
      mime_type: "application/vnd.google-apps.folder",
      modified_time: Time.now.iso8601,
      created_time: Time.now.iso8601,
      web_view_link: "https://drive.google.com/drive/folders/subfolder1"
    )
    allow(drive_service).to receive(:list_files).and_return(double(files: [file2, subfolder]))

    documents, total, _, errors = described_class.new(config).call

    expect(documents.map { |d| d[:external_id] }).to eq(["file2"])
    expect(total).to eq(1)
    expect(errors).to contain_exactly(
      external_id: "subfolder1",
      title: "Archive",
      link: "https://drive.google.com/drive/folders/subfolder1",
      reason: "folder_not_supported",
      details: nil
    )
  end

  it "returns share email" do
    allow(ENV).to receive(:[]).with("GOOGLE_DRIVE_SHARE_EMAIL").and_return("your-service-account@your-project-id.iam.gserviceaccount.com")
    expect(described_class.share_email).to eq("your-service-account@your-project-id.iam.gserviceaccount.com")
  end

  it "handles AWS credentials" do
    ingestor = described_class.new(config)

    # Test 1: Early return when credentials already exist
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("AWS_ACCESS_KEY_ID").and_return("existing_key")
    allow(ENV).to receive(:[]).with("AWS_SECRET_ACCESS_KEY").and_return("existing_secret")
    allow(ENV).to receive(:[]).with("AWS_SESSION_TOKEN").and_return("existing_token")

    ingestor.send(:ensure_aws_env_credentials_from_ecs!)
    # Should return early without making HTTP request

    # Test 2: Early return when no relative URI is present
    allow(ENV).to receive(:[]).with("AWS_ACCESS_KEY_ID").and_return(nil)
    allow(ENV).to receive(:[]).with("AWS_SECRET_ACCESS_KEY").and_return(nil)
    allow(ENV).to receive(:[]).with("AWS_SESSION_TOKEN").and_return(nil)
    allow(ENV).to receive(:[]).with("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI").and_return(nil)

    ingestor.send(:ensure_aws_env_credentials_from_ecs!)
    # Should return early without making HTTP request

    # Test 3: Error handling when HTTP request fails
    allow(ENV).to receive(:[]).with("AWS_CONTAINER_CREDENTIALS_RELATIVE_URI").and_return("/v2/credentials/test-task-id")

    mock_error_response = instance_double(Net::HTTPNotFound,
      code: "404",
      body: "Not Found")
    allow(mock_error_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
    allow(Net::HTTP).to receive(:get_response).and_return(mock_error_response)

    expect do
      ingestor.send(:ensure_aws_env_credentials_from_ecs!)
    end.to raise_error("Failed to fetch ECS task credentials (404): Not Found")

    # Test 4: Success path - fetches and sets credentials
    allow(ENV).to receive(:[]=)

    mock_success_response = instance_double(Net::HTTPSuccess,
      code: "200",
      body: {
        "AccessKeyId" => "ASIA123456789",
        "SecretAccessKey" => "secret123",
        "Token" => "token123"
      }.to_json)
    allow(mock_success_response).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
    allow(Net::HTTP).to receive(:get_response).and_return(mock_success_response)

    ingestor.send(:ensure_aws_env_credentials_from_ecs!)

    # Verify credentials were set
    expect(ENV).to have_received(:[]=).with("AWS_ACCESS_KEY_ID", "ASIA123456789")
    expect(ENV).to have_received(:[]=).with("AWS_SECRET_ACCESS_KEY", "secret123")
    expect(ENV).to have_received(:[]=).with("AWS_SESSION_TOKEN", "token123")

    # Verify HTTP request was made to correct endpoint
    expect(Net::HTTP).to have_received(:get_response).at_least(:once) do |uri|
      expect(uri.host).to eq("169.254.170.2")
      expect(uri.path).to eq("/v2/credentials/test-task-id")
    end
  end
end
