require "rails_helper"

RSpec.describe CsvExporter, type: :service do
  describe ".generate" do
    it "generates CSV with headers" do
      headers = ["Name", "Email", "Age"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        # No rows added
      end

      lines = csv.split("\n")
      expect(lines[0]).to eq("Name,Email,Age")
      expect(lines.size).to eq(1)
    end

    it "yields CSV object to block for row generation" do
      headers = ["Name", "Email"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["John Doe", "john@example.com"]
        csv << ["Jane Smith", "jane@example.com"]
      end

      lines = csv.split("\n")
      expect(lines[0]).to eq("Name,Email")
      expect(lines[1]).to eq("John Doe,john@example.com")
      expect(lines[2]).to eq("Jane Smith,jane@example.com")
    end

    it "returns valid CSV string" do
      headers = ["ID", "Name"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << [1, "Product"]
      end

      expect(csv).to be_a(String)
      expect(CSV.parse(csv, headers: true).first["ID"]).to eq("1")
      expect(CSV.parse(csv, headers: true).first["Name"]).to eq("Product")
    end

    it "handles empty data (headers only)" do
      headers = ["Column1", "Column2"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        # No rows
      end

      lines = csv.split("\n")
      expect(lines.size).to eq(1)
      expect(lines[0]).to eq("Column1,Column2")
    end

    it "handles multiple rows" do
      headers = ["ID"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        10.times { |i| csv << [i] }
      end

      lines = csv.split("\n")
      expect(lines.size).to eq(11) # 1 header + 10 rows
    end

    it "handles special characters - commas in data" do
      headers = ["Name", "Description"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["Product", "A product with, comma"]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["Description"]).to eq("A product with, comma")
    end

    it "handles special characters - quotes in data" do
      headers = ["Name", "Quote"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["Author", 'She said "Hello"']
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["Quote"]).to eq('She said "Hello"')
    end

    it "handles special characters - newlines in data" do
      headers = ["Name", "Text"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["Item", "Line 1\nLine 2"]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["Text"]).to eq("Line 1\nLine 2")
    end

    it "handles nil values" do
      headers = ["Name", "Email"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["John", nil]
        csv << [nil, "email@example.com"]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed[0]["Email"]).to be_nil
      expect(parsed[1]["Name"]).to be_nil
    end

    it "can be used with find_each pattern" do
      headers = ["ID", "Value"]

      # Simulate ActiveRecord find_each behavior
      items = [
        double(id: 1, value: "A"),
        double(id: 2, value: "B"),
        double(id: 3, value: "C")
      ]

      csv = CsvExporter.generate(headers: headers) do |csv|
        items.each do |item|
          csv << [item.id, item.value]
        end
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.size).to eq(3)
      expect(parsed[0]["ID"]).to eq("1")
      expect(parsed[2]["Value"]).to eq("C")
    end

    ["=", "+", "-", "@", "%", "|", "\t", "\r", "\n"].each do |prefix|
      it "escapes a formula-injection payload starting with #{prefix.inspect}" do
        headers = ["Name", "Comment"]
        csv = CsvExporter.generate(headers: headers) do |csv|
          csv << ["Reporter", "#{prefix}1+1"]
        end

        parsed = CSV.parse(csv, headers: true)
        expect(parsed.first["Comment"]).to eq("'#{prefix}1+1")
      end
    end

    it "escapes a formula-injection payload hidden behind leading whitespace" do
      headers = ["Name", "Comment"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << ["Reporter", " =1+1"]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["Comment"]).to eq("' =1+1")
    end

    it "does not raise on a string with invalid encoding" do
      headers = ["Name", "Comment"]
      invalid = "\xFF\xFE".dup.force_encoding("UTF-8")

      expect {
        CsvExporter.generate(headers: headers) { |csv| csv << ["Reporter", invalid] }
      }.not_to raise_error
    end

    it "leaves integers alone" do
      headers = ["ID", "Count"]
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << [1, -5]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["ID"]).to eq("1")
      expect(parsed.first["Count"]).to eq("-5")
    end

    it "leaves an iso8601 string alone" do
      headers = ["Created At"]
      timestamp = Time.zone.parse("2024-01-01 12:00:00").iso8601
      csv = CsvExporter.generate(headers: headers) do |csv|
        csv << [timestamp]
      end

      parsed = CSV.parse(csv, headers: true)
      expect(parsed.first["Created At"]).to eq(timestamp)
    end
  end

  describe ".write" do
    it "writes the headers and rows to the given IO" do
      io = StringIO.new

      CsvExporter.write(io, headers: ["Name", "Email"]) do |csv|
        csv << ["John Doe", "john@example.com"]
      end

      expect(io.string).to eq("Name,Email\nJohn Doe,john@example.com\n")
    end

    it "escapes a formula-injection payload" do
      io = StringIO.new

      CsvExporter.write(io, headers: ["Comment"]) { |csv| csv << ["=1+1"] }

      expect(CSV.parse(io.string, headers: true).first["Comment"]).to eq("'=1+1")
    end
  end
end
