module HasUniqueTitle
  extend ActiveSupport::Concern

  included do
    before_validation :ensure_unique_title, on: :create
  end

  def ensure_unique_title
    return if title.blank?

    base = title.gsub(/\s\[\d+\]\z/, "") # Strip trailing [n]
    counter = 1

    while title_exists?
      self.title = "#{base} [#{counter}]"
      counter += 1
    end
  end
end
