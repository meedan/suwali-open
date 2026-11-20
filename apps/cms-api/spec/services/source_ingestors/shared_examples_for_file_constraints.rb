RSpec.shared_examples "a FileConstraints ingestor" do
  expected_mime_types = {
    "application/pdf" => "pdf",
    "text/plain" => "txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document" => "docx",
    "text/markdown" => "md"
  }.freeze

  it "supports the documented mime types" do
    expect(SourceIngestors::FileConstraints::SUPPORTED_MIME_TYPES).to eq(expected_mime_types)
  end

  expected_mime_types.each do |mime_type, extension|
    it "ingests a #{extension} document from mime type #{mime_type}" do
      document_type = ingest_supported_file(mime_type: mime_type, extension: extension)

      expect(document_type).to eq(extension)
    end
  end

  it "supports the documented extension aliases" do
    expect(SourceIngestors::FileConstraints::EXTENSION_ALIASES).to eq({"markdown" => "md"})
  end

  it "ingests a markdown document from the .markdown extension alias" do
    document_type = ingest_supported_file(mime_type: "text/markdown", extension: "markdown")

    expect(document_type).to eq("md")
  end
end
