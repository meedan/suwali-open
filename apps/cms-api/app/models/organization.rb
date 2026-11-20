class Organization < ApplicationRecord
  has_many :hubs

  validates :name, presence: true
end
