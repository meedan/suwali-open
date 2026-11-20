require "rails_helper"
require_relative "shared_examples_for_file_constraints"

RSpec.describe SourceIngestors::UploadedFiles do
  let(:subject) { described_class.new }

  def uploaded_file(filename, content: "file content", content_type: "application/pdf")
    Rack::Test::UploadedFile.new(
      StringIO.new(content),
      content_type,
      original_filename: filename
    )
  end

  def ingest_supported_file(mime_type:, extension:)
    files = [uploaded_file("file.#{extension}", content_type: mime_type)]

    documents, _, _ = subject.call(files: files)

    documents.first&.dig(:document_type)
  end

  describe "#call" do
    it_behaves_like "a FileConstraints ingestor"

    it "returns document data for valid files" do
      files = [uploaded_file("report.pdf"), uploaded_file("notes.txt", content_type: "text/plain")]

      documents, total, suggested_name = subject.call(files: files)

      expect(documents.size).to eq(2)
      expect(total).to eq(2)
      expect(suggested_name).to eq(I18n.t(:uploaded_files_source_default_title))
      expect(documents.first[:title]).to eq("report.pdf")
      expect(documents.first[:document_type]).to eq("pdf")
      expect(documents.first[:file]).to eq(files.first)
      expect(documents.second[:title]).to eq("notes.txt")
      expect(documents.second[:document_type]).to eq("txt")
    end

    it "reads the file content for markdown files" do
      files = [uploaded_file("notes.md", content: "# Heading\n\nSome text.", content_type: "text/markdown")]

      documents, _, _ = subject.call(files: files)

      expect(documents.first[:content]).to eq("# Heading\n\nSome text.")
    end

    it "still attaches the full file after reading markdown content" do
      files = [uploaded_file("notes.md", content: "# Heading\n\nSome text.", content_type: "text/markdown")]

      documents, _, _ = subject.call(files: files)

      expect(documents.first[:file].read).to eq("# Heading\n\nSome text.")
    end

    it "sanitizes invalid byte sequences in markdown content so it can be persisted" do
      invalid_utf8_bytes = "# Caf\xE9 notes".b
      files = [uploaded_file("notes.md", content: invalid_utf8_bytes, content_type: "text/markdown")]

      documents, _, _ = subject.call(files: files)

      expect(documents.first[:content].encoding).to eq(Encoding::UTF_8)
      expect(documents.first[:content]).to be_valid_encoding
    end

    it "does not set content for non-markdown files" do
      files = [uploaded_file("report.pdf")]

      documents, _, _ = subject.call(files: files)

      expect(documents.first[:content]).to be_nil
    end

    it "includes a unique external_id for each document" do
      files = [uploaded_file("report.pdf"), uploaded_file("other.pdf")]

      documents, _, _ = subject.call(files: files)

      ids = documents.map { |d| d[:external_id] }
      expect(ids.uniq.size).to eq(2)
      ids.each { |id| expect(id).to match(/\A[0-9a-f-]{36}\z/) }
    end

    it "raises for unsupported file extensions" do
      files = [uploaded_file("image.png", content_type: "image/png")]

      expect { subject.call(files: files) }.to raise_error(RuntimeError, /image\.png/)
    end

    it "raises for oversized files" do
      large_content = "x" * (SourceIngestors::FileConstraints::MAX_SIZE_BYTES + 1)
      files = [uploaded_file("big.pdf", content: large_content)]

      expect { subject.call(files: files) }.to raise_error(RuntimeError, /big\.pdf/)
    end

    it "raises and returns no data when any file is invalid" do
      files = [
        uploaded_file("valid.pdf"),
        uploaded_file("bad.png", content_type: "image/png")
      ]

      expect { subject.call(files: files) }.to raise_error(RuntimeError, /bad\.png/)
    end

    it "raises when more than MAX_FILES_PER_UPLOAD files are provided" do
      files = 6.times.map { |i| uploaded_file("file#{i}.pdf") }

      expect { subject.call(files: files) }.to raise_error(RuntimeError, /too many files/i)
    end

    it "accepts exactly MAX_FILES_PER_UPLOAD files" do
      files = 5.times.map { |i| uploaded_file("file#{i}.pdf") }

      documents, _, _ = subject.call(files: files)

      expect(documents.size).to eq(5)
    end
  end
end
