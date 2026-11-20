class DeletedDocument < ApplicationRecord
  belongs_to :source

  validates :external_id, :source_id, presence: true
  validates :external_id, uniqueness: {scope: :source_id}
end
