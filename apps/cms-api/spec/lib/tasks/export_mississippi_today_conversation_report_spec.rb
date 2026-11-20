require "rails_helper"
require "rake"

RSpec.describe "export_mississippi_today_conversation_report" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("export_mississippi_today_conversation_report")
  end

  after do
    Rake::Task["export_mississippi_today_conversation_report"].reenable
  end

  let!(:hub) { create(:hub, id: 3) }
  let(:storage) { ActiveStorage::Blob.service }
  let(:input_key) { "exports/mississippi_today_conversation_report/input.csv" }

  def stub_storage(input)
    allow(storage).to receive(:download).with(input_key).and_return(input)
    allow(storage).to receive(:delete)
    allow(storage).to receive(:url).and_return("https://example.org/report.csv")
  end

  def run_task(input)
    uploaded = nil
    stub_storage(input)
    allow(storage).to receive(:upload) { |_key, io, **| uploaded = io.read }

    expect { Rake::Task["export_mississippi_today_conversation_report"].invoke }.to output.to_stdout
    CSV.parse(uploaded, headers: true)
  end

  def end_user_conversation(external_id, hub: self.hub, **attributes)
    user = create(:external_user, hub: hub, platform: :sms, external_id: external_id)
    create(:conversation, hub: hub, platform: :sms, participant: user, **attributes)
  end

  def ask(conversation, answered:, created_at: Time.current)
    question = create(:message, :incoming, conversation: conversation, external_id: SecureRandom.hex, created_at: created_at)
    create(:message, :outgoing, conversation: conversation, reply_to: question, answered: answered)
    question
  end

  it "exports question counts, first interaction and topics per conversation, keyed by response_id" do
    conversation = end_user_conversation("+16015550100", created_at: Time.utc(2026, 10, 1, 11, 59))
    first = ask(conversation, answered: true, created_at: Time.utc(2026, 10, 1, 12))
    ask(conversation, answered: true, created_at: Time.utc(2026, 10, 2, 12))
    second = ask(conversation, answered: false, created_at: Time.utc(2026, 10, 3, 12))
    ask(conversation, answered: nil, created_at: Time.utc(2026, 10, 4, 12))
    create(:topic_item, topic: create(:topic, hub: hub, name: "Voting"), item: first)
    create(:topic_item, topic: create(:topic, hub: hub, name: "Elections"), item: second)

    rows = run_task("response_id,submitted_cell_phone\nR_1,6015550100\n")

    expect(rows.map(&:to_h)).to eq([{
      "response_id" => "R_1",
      "date/time of first interaction" => "2026-10-01T11:59:00Z",
      "number of questions asked" => "3",
      "number of questions answered" => "2",
      "number of questions not answered" => "1",
      "conversation topics" => "Elections; Voting"
    }])
  end

  it "includes soft-deleted conversations" do
    conversation = end_user_conversation("+16015550100", deleted_at: 1.day.ago)

    rows = run_task("response_id,submitted_cell_phone\nR_1,6015550100\n")

    expect(rows.map { |row| row["date/time of first interaction"] }).to eq([conversation.created_at.utc.iso8601])
  end

  it "does not match end-users of other hubs and still writes a row for the unmatched tuple" do
    end_user_conversation("+16015550100", hub: create(:hub))

    rows = run_task("response_id,submitted_cell_phone\nR_1,6015550100\n")

    expect(rows.map(&:to_h)).to eq([{
      "response_id" => "R_1", "date/time of first interaction" => nil,
      "number of questions asked" => nil, "number of questions answered" => nil, "number of questions not answered" => nil, "conversation topics" => nil
    }])
  end

  it "leaves phone numbers out of the export and deletes the input" do
    end_user_conversation("+16015550100")

    rows = run_task("response_id,submitted_cell_phone\nR_1,6015550100\n")

    expect(rows.to_s).not_to include("6015550100")
    expect(storage).to have_received(:delete).with(input_key)
  end

  it "keeps the input when the upload fails, so the export can be retried" do
    stub_storage("response_id,submitted_cell_phone\nR_1,6015550100\n")
    allow(storage).to receive(:upload).and_raise(Aws::S3::Errors::ServiceError.new(nil, "upload failed"))

    expect {
      expect { Rake::Task["export_mississippi_today_conversation_report"].invoke }.to output.to_stdout
    }.to raise_error(Aws::S3::Errors::ServiceError)
    expect(storage).not_to have_received(:delete)
  end

  it "prints the download link and the command to delete the export" do
    stub_storage("response_id,submitted_cell_phone\nR_1,6015550100\n")
    allow(storage).to receive(:upload)

    expect { Rake::Task["export_mississippi_today_conversation_report"].invoke }.to output(
      %r{Download \(valid for 1 hour\): https://example\.org/report\.csv\n.*aws s3 rm s3://#{storage.bucket.name}/exports/mississippi_today_conversation_report/\d{8}T\d{6}Z\.csv}
    ).to_stdout
  end
end
