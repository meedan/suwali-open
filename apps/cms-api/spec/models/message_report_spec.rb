require "rails_helper"

RSpec.describe MessageReport, type: :model do
  let(:reporter) { create(:user) }

  it "is valid with valid attributes" do
    message = create(:message, direction: "outgoing")
    report = build(:message_report, message: message, reported_by: reporter, comment: "Bot gave a wrong answer")
    expect(report).to be_valid
  end

  it "is invalid if message is not a bot message" do
    user_message = create(:message, direction: "incoming")
    report = build(:message_report, message: user_message, reported_by: reporter)

    expect(report).not_to be_valid
    report.validate
    expect(report.errors[:base]).to include(I18n.t(:error_message_report_must_be_bot_message))
  end

  it "raises an error when message is nil" do
    expect {
      build(:message_report, message: nil, reported_by: reporter).validate
    }.to raise_error(NoMethodError)
  end

  it "requires reported_by" do
    bot_message = create(:message, direction: "outgoing")
    report = build(:message_report, message: bot_message, reported_by: nil)
    expect(report).not_to be_valid
    report.validate
    expect(report.errors[:reported_by]).to_not be_empty
  end
end
