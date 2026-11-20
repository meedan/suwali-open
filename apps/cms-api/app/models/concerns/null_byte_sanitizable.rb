module NullByteSanitizable
  extend ActiveSupport::Concern

  class_methods do
    def sanitize_null_bytes(*attributes)
      string_attrs, complex_attrs = attributes.partition { |attr| columns_hash[attr.to_s]&.type == :string || columns_hash[attr.to_s]&.type == :text }

      string_attrs.each do |attr|
        normalizes attr, with: ->(value) { value&.delete("\u0000") }
      end

      before_validation -> {
        complex_attrs.each do |attr|
          value = send(attr)
          next if value.blank?

          send(:"#{attr}=", JSON.parse(value.to_json.gsub('\u0000', "").delete("\u0000")))
        end
      }
    end
  end
end
