require "httparty"
require "tempfile"
require "json"
require_relative "http_client"

module SourceIngestors
  class JsonApi
    def initialize(config = {})
      @base_url = config["base_url"]
      @pagination_start = config.fetch("pagination_start", 1)
      @pagination_end = config.fetch("pagination_end", 10)
      @page_param = config.fetch("page_param", "page")
      @page_size_param = config.fetch("page_size_param", "page_size")
      @page_size = config.fetch("page_size", 50)
      @records_path = config.fetch("records_path", "results")
      @total_path = config.fetch("total_path", "total")

      field_mappings = config.fetch("field_mappings", {})
      @title_field = field_mappings.fetch("title", "title")
      @content_field = field_mappings.fetch("content", "content")
      @external_id_field = field_mappings.fetch("external_id", "id")
      @url_field = field_mappings["url"]
      @date_field = field_mappings["date"]

      @headers = config["headers"] || {}
      @query_params = config["query_params"] || {}
      @http_client = HttpClient.new(user_agent: config[:user_agent])
    end

    def call(existing_documents_scope: nil, deleted_documents_scope: nil)
      return [[], nil, nil, nil, nil] if @base_url.blank?

      @existing_docs_scope = existing_documents_scope
      @deleted_docs_scope = deleted_documents_scope
      documents = []
      total = nil
      total_seen = 0

      catch(:abort_ingestion) do
        (@pagination_start..@pagination_end).each do |page|
          params = @query_params.merge({
            @page_param => page,
            @page_size_param => @page_size
          })

          response_data = fetch_api_data(params)
          records = extract_records(response_data)
          total ||= extract_total(response_data)
          total_seen += records.size

          break if records.empty?

          records.each do |record|
            doc_data = extract_document_data(record)
            throw :abort_ingestion if doc_data[:error] == :abort
            next if doc_data[:error] == :skip
            documents << doc_data
          end
        rescue => e
          raise "Failed to fetch JSON API data from #{@base_url} (page #{page}): #{e.message}"
        end
      end

      [documents, total || total_seen, nil, nil, nil]
    end

    def as_file(doc_data)
      tempfile = Tempfile.new(["json_api_record_", ".txt"])
      tempfile.write("#{doc_data[:title]}\n\nDate: #{doc_data[:date]}\n\n#{doc_data[:content]}")
      tempfile.rewind
      tempfile.path
    end

    private

    def fetch_api_data(params)
      response = @http_client.get(@base_url, params: params, headers: @headers)

      unless response.success?
        raise "API request failed with status #{response.code}: #{response.message}"
      end

      begin
        JSON.parse(response.body)
      rescue JSON::ParserError => e
        raise "Invalid JSON response: #{e.message}"
      end
    end

    def extract_total(response_data)
      return nil if @total_path.blank?
      return nil unless response_data.is_a?(Hash)

      total = response_data
      @total_path.split(".").each do |key|
        total = total.is_a?(Hash) ? total[key] : nil
        break if total.nil?
      end

      total
    end

    def extract_records(response_data)
      return response_data if @records_path.blank?
      return [] unless response_data.is_a?(Hash)

      records = response_data
      @records_path.split(".").each do |key|
        records = records.is_a?(Hash) ? records[key] : nil
        break if records.nil?
      end

      records.is_a?(Array) ? records : []
    end

    def extract_document_data(record)
      return {error: :skip} unless record.is_a?(Hash)

      # Extract external_id first to check existence before processing
      external_id = extract_field_value(record, @external_id_field)
      return {error: :skip} if external_id.blank?

      # Abort pagination if already ingested — signals caller to stop fetching further pages
      external_id_str = external_id.to_s
      return {error: :abort} if @existing_docs_scope&.exists?(external_id: external_id_str) || @deleted_docs_scope&.exists?(external_id: external_id_str)

      title = extract_field_value(record, @title_field)
      content = extract_field_value(record, @content_field)

      return {error: :skip} if title.blank?

      # Content can be empty for some records (e.g., just metadata)
      content = ActionController::Base.helpers.strip_tags(content.to_s.strip).squish

      url = @url_field ? extract_field_value(record, @url_field) : nil
      date = @date_field ? extract_field_value(record, @date_field) : nil

      {
        external_id: external_id_str,
        title: title.to_s.strip,
        content: content,
        date: date,
        public_url: url,
        metadata: {
          url: url,
          date: date,
          source_data: record.except(@title_field, @content_field)
        }.compact,
        document_type: "json",
        raw_data: record # Store original JSON for the file
      }
    end

    def extract_field_value(record, field_path)
      return nil if field_path.blank?

      value = record
      field_path.split(".").each do |key|
        value = value.is_a?(Hash) ? value[key] : nil
        break if value.nil?
      end

      value
    end
  end
end
