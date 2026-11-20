module Anonymizable
  extend ActiveSupport::Concern

  included do
    class_attribute :_anonymizable_fields, default: []
    class_attribute :_anonymizable_json_fields, default: {}
  end

  class_methods do
    def anonymizable(*fields)
      self._anonymizable_fields = _anonymizable_fields | fields.map(&:to_s)
    end

    def anonymizable_json(field, keys:)
      self._anonymizable_json_fields = _anonymizable_json_fields.merge(field.to_s => keys.map(&:to_s))
    end
  end

  def anonymized_attributes
    result = _anonymizable_fields.index_with { "[ANONYMIZED]" }

    _anonymizable_json_fields.each do |field, keys|
      current = read_attribute(field)
      next unless current.is_a?(Hash)
      result[field] = deep_redact(current, keys)
    end

    result
  end

  private

  def deep_redact(hash, keys)
    keys.group_by { |k| k.split(".", 2).first }.each_with_object(hash.deep_dup) do |(root, root_keys), result|
      next unless result.key?(root)
      _plain, nested = root_keys.partition { |k| !k.include?(".") }
      child_keys = nested.map { |k| k.split(".", 2)[1] }
      result[root] = if child_keys.any? && result[root].is_a?(Hash)
        deep_redact(result[root], child_keys)
      else
        "[ANONYMIZED]"
      end
    end
  end
end
