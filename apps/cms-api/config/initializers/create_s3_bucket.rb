return if Rails.env.production?

require "aws-sdk-s3"

s3 = Aws::S3::Client.new(
  access_key_id: ENV.fetch("S3_ACCESS_KEY_ID"),
  secret_access_key: ENV.fetch("S3_SECRET_ACCESS_KEY"),
  region: ENV.fetch("S3_REGION"),
  endpoint: ENV["S3_ENDPOINT"], # Needed for Silo
  force_path_style: true        # Important for Silo
)

bucket = ENV.fetch("S3_BUCKET")

begin
  s3.head_bucket(bucket: bucket)
rescue Aws::S3::Errors::NotFound, Aws::S3::Errors::NoSuchBucket
  puts "Creating S3 bucket '#{bucket}'..."
  s3.create_bucket(bucket: bucket)
rescue Aws::S3::Errors::BucketAlreadyOwnedByYou
  # Bucket exists and is owned, do nothing
rescue => e
  warn "Failed to verify/create S3 bucket: #{e.class} - #{e.message}"
end
