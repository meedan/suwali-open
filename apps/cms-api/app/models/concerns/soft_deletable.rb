module SoftDeletable
  extend ActiveSupport::Concern

  included do
    scope :not_deleted, -> { where(deleted_at: nil) }
    scope :deleted, -> { where.not(deleted_at: nil) }
  end

  class_methods do
    def async_destroy_with(worker_class)
      @soft_delete_worker = worker_class
    end

    def soft_delete_worker
      @soft_delete_worker || raise(NotImplementedError, "#{name} must call `async_destroy_with WorkerClass`")
    end
  end

  def deleted?
    deleted_at.present?
  end

  def readonly?
    # Allow updates if deleted_at is being set for the first time
    return false if deleted_at_was.nil? && deleted_at.present?

    # Otherwise, readonly if deleted
    deleted_at_was.present?
  end

  def destroy_async!
    update!(deleted_at: Time.current)
    self.class.soft_delete_worker.perform_in(15.seconds, id)
  end

  # Include in child models that belong to a SoftDeletable parent.
  # Usage: include SoftDeletable::Child
  #        validates_parent_not_deleted :source
  module Child
    extend ActiveSupport::Concern

    class_methods do
      def validates_parent_not_deleted(association)
        validate(on: :create) do
          errors.add(:base, I18n.t(:error_parent_deleted)) if public_send(association)&.deleted?
        end
      end
    end
  end
end
