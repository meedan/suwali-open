# RAILS_ENV=production bundle exec rake export_mississippi_today_conversation_report
#
# One-off export for Mississippi Today (hub 3). Reads a `response_id,submitted_cell_phone` CSV from
# input_key in S3_BUCKET, uploads one row per conversation without phone numbers, then deletes the input.
require "csv"

desc "Exports per-conversation question and topic stats for Mississippi Today end-users to S3"
task export_mississippi_today_conversation_report: :environment do
  input_key = "exports/mississippi_today_conversation_report/input.csv"
  hub = Hub.find(3)
  puts "Hub: #{hub.name} (id=#{hub.id})"

  storage = ActiveStorage::Blob.service
  tuples = CSV.parse(storage.download(input_key), headers: true)
  unmatched = 0

  headers = [
    "response_id",
    "date/time of first interaction",
    "number of questions asked",
    "number of questions answered",
    "number of questions not answered",
    "conversation topics"
  ]

  output = CsvExporter.generate(headers: headers) do |csv|
    tuples.each do |tuple|
      # The hub is SMS-only, stored as +1XXXXXXXXXX; the input omits the +1
      conversations = hub.conversations
        .where(participant: hub.external_users.where(external_id: "+1#{tuple["submitted_cell_phone"]}"))
        .order(:created_at)

      if conversations.empty?
        unmatched += 1
        csv << [tuple["response_id"]]
      end

      conversations.each do |conversation|
        messages = conversation.messages
        csv << [
          tuple["response_id"],
          conversation.created_at.utc.iso8601,
          messages.external_with_bot_answer_verdict.count,
          messages.external_with_answered_bot_reply(true).count,
          messages.external_with_answered_bot_reply(false).count,
          messages.incoming.joins(:topics).distinct.order("topics.name").pluck("topics.name").join("; ")
        ]
      end
    end
  end

  key = "exports/mississippi_today_conversation_report/#{Time.current.utc.strftime("%Y%m%dT%H%M%SZ")}.csv"
  storage.upload(key, StringIO.new(output), content_type: "text/csv")
  # Deleted only once the export is safely uploaded, so a failed run can be retried
  storage.delete(input_key)
  url = storage.url(key, expires_in: 1.hour, filename: ActiveStorage::Filename.new(File.basename(key)),
    disposition: :attachment, content_type: "text/csv")

  puts "Tuples: #{tuples.size}, unmatched: #{unmatched}"
  puts "Download (valid for 1 hour): #{url}"
  puts "Delete once downloaded: aws s3 rm s3://#{storage.bucket.name}/#{key}"
end
