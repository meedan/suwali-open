class BulkConversationExport < ApplicationRecord
  TTL = 4.hours
  MAX_CONVERSATIONS = 5_000

  belongs_to :hub
  belongs_to :requested_by, class_name: "User"
  has_one_attached :file

  enum status: {pending: 0, ready: 1, failed: 2, expired: 3}

  scope :expired_by_ttl, -> { where(created_at: ...TTL.ago) }

  after_commit :enqueue_export, on: :create

  def conversations
    latest_ids = hub.conversations.not_deleted.order(id: :desc).limit(MAX_CONVERSATIONS).select(:id)
    hub.conversations.where(id: latest_ids)
  end

  def expires_at
    created_at + TTL
  end

  # Signed per call; production STS credentials can end a presigned URL before its expires_in
  def download_url
    return unless ready? && expires_at.future?

    download_service.url(
      file.key,
      expires_in: expires_at - Time.current,
      disposition: :attachment,
      filename: file.filename,
      content_type: file.content_type_for_serving
    )
  end

  def as_json(_options = {})
    {id: id, status: status, created_at: created_at, expires_at: expires_at, download_url: download_url}
  end

  private

  # Blobs on s3 are signed with the public endpoint; any other service keeps its own URLs
  def download_service
    (file.service_name == Rails.application.config.active_storage.service.to_s) ? ActiveStorage::Blob.services.fetch(:s3_public) : file.service
  end

  def enqueue_export
    BulkConversationExportWorker.perform_async(id)
  end
end
