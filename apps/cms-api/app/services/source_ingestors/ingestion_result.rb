module SourceIngestors
  IngestionResult = Struct.new(:documents, :total, :suggested_name, :errors, :suggested_url, keyword_init: true) do
    def to_ary
      [documents, total, suggested_name, errors, suggested_url]
    end
  end
end
