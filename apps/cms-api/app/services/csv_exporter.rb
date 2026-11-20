class CsvExporter
  def self.generate(headers:)
    require "csv"
    CSV.generate(headers: true) do |csv|
      csv << headers
      yield SanitizingCsv.new(csv)
    end
  end

  def self.write(io, headers:)
    require "csv"
    csv = CSV.new(io)
    csv << headers
    yield SanitizingCsv.new(csv)
  end

  class SanitizingCsv
    FORMULA_PREFIXES = ["=", "+", "-", "@", "%", "|", "\t", "\r", "\n"].freeze

    def initialize(csv)
      @csv = csv
    end

    def <<(row)
      @csv << row.map { |value| sanitize_cell(value) }
    end

    private

    def sanitize_cell(value)
      return value unless value.is_a?(String)

      starts_with_formula_prefix?(value) ? "'#{value}" : value
    end

    def starts_with_formula_prefix?(value)
      return true if value.start_with?(*FORMULA_PREFIXES)

      # Checked separately from lstrip below: \t/\r/\n are prefixes lstrip would also strip.
      value.valid_encoding? && value.lstrip.start_with?(*FORMULA_PREFIXES)
    end
  end
end
