require "rails_helper"
require "rake"

RSpec.describe "backfill_answered_no_answer_available" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("backfill_answered_no_answer_available")
  end

  after do
    Rake::Task["backfill_answered_no_answer_available"].reenable
    ENV.delete("apply")
  end

  def run_task
    Rake::Task["backfill_answered_no_answer_available"].invoke
  end

  it "does not update anything when apply is not set" do
    message = create(:message, :outgoing, answered: nil, metadata: {"error_type" => "NO_ANSWER_AVAILABLE"}, reply_to: create(:message, :incoming))

    expect { run_task }.not_to change { message.reload.answered }
  end

  it "sets answered to false when apply=true" do
    ENV["apply"] = "true"
    message = create(:message, :outgoing, answered: nil, metadata: {"error_type" => "NO_ANSWER_AVAILABLE"}, reply_to: create(:message, :incoming))

    expect { run_task }.to change { message.reload.answered }.from(nil).to(false)
  end

  it "does not touch incoming messages" do
    ENV["apply"] = "true"
    message = create(:message, :incoming, answered: nil, metadata: {"error_type" => "NO_ANSWER_AVAILABLE"})

    expect { run_task }.not_to change { message.reload.answered }
  end

  it "does not touch messages with answered already set" do
    ENV["apply"] = "true"
    message = create(:message, :outgoing, answered: true, metadata: {"error_type" => "NO_ANSWER_AVAILABLE"}, reply_to: create(:message, :incoming))

    expect { run_task }.not_to change { message.reload.answered }
  end

  it "does not touch messages with a different error_type" do
    ENV["apply"] = "true"
    message = create(:message, :outgoing, answered: nil, metadata: {"error_type" => "SOME_OTHER_ERROR"}, reply_to: create(:message, :incoming))

    expect { run_task }.not_to change { message.reload.answered }
  end

  it "does not touch messages without a reply_to_id" do
    ENV["apply"] = "true"
    message = create(:message, :outgoing, answered: nil, metadata: {"error_type" => "NO_ANSWER_AVAILABLE"})

    expect { run_task }.not_to change { message.reload.answered }
  end
end
