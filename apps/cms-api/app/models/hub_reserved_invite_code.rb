class HubReservedInviteCode < ApplicationRecord
  validates :code, presence: true, uniqueness: true
end
