require "rails_helper"

RSpec.describe PlatformStatisticsService, type: :service do
  let(:service) { PlatformStatisticsService.new }

  around do |example|
    Message.skip_callback(:commit, :after, :process_incoming_message)
    Message.skip_callback(:commit, :after, :enqueue_message_sender)
    Message.skip_callback(:commit, :after, :update_conversation)
    Message.skip_callback(:commit, :after, :update_external_user)
    Message.skip_callback(:commit, :after, :schedule_inactivity_check)
    example.run
    Message.set_callback(:commit, :after, :process_incoming_message)
    Message.set_callback(:commit, :after, :enqueue_message_sender)
    Message.set_callback(:commit, :after, :update_conversation)
    Message.set_callback(:commit, :after, :update_external_user)
    Message.set_callback(:commit, :after, :schedule_inactivity_check)
  end

  describe "#initialize" do
    it "defaults group_by to week" do
      expect(service.instance_variable_get(:@group_by)).to eq("week")
    end

    it "defaults from to 4 weeks ago" do
      expect(service.instance_variable_get(:@from)).to be_within(1.second).of(4.weeks.ago.beginning_of_day)
    end

    it "accepts custom group_by" do
      s = PlatformStatisticsService.new(group_by: "month")
      expect(s.instance_variable_get(:@group_by)).to eq("month")
    end

    it "falls back to week for an invalid group_by value" do
      s = PlatformStatisticsService.new(group_by: "invalid")
      expect(s.instance_variable_get(:@group_by)).to eq("week")
    end

    it "accepts custom from and to dates" do
      from = 2.months.ago
      to = 1.week.ago
      s = PlatformStatisticsService.new(from: from, to: to)
      expect(s.instance_variable_get(:@from)).to eq(from)
      expect(s.instance_variable_get(:@to)).to eq(to)
    end

    it "clamps from when the requested range exceeds the maximum allowed span" do
      to = Time.now.end_of_day
      from = to - 3.years

      s = PlatformStatisticsService.new(from: from, to: to)

      expect(s.instance_variable_get(:@from)).to be_within(1.second).of(to - DateBucketing::MAX_DATE_RANGE)
    end

    it "logs when the date range is clamped" do
      to = Time.now.end_of_day
      from = to - 3.years

      expect(LogService).to receive(:log).with(:info, "PlatformStatisticsService", a_string_matching(/clamp/i))

      PlatformStatisticsService.new(from: from, to: to)
    end

    it "does not clamp or log when the requested range is within the maximum allowed span" do
      to = Time.now.end_of_day
      from = to - 1.month

      expect(LogService).not_to receive(:log)

      s = PlatformStatisticsService.new(from: from, to: to)

      expect(s.instance_variable_get(:@from)).to eq(from)
    end
  end

  describe "#documents_by_sync_status" do
    it "returns an array of buckets with date and sync status keys" do
      result = service.documents_by_sync_status
      expect(result).to be_an(Array)
      expect(result.first).to include("date", "pending", "error", "complete")
    end

    it "supports group_by: day" do
      s = PlatformStatisticsService.new(group_by: "day")
      result = s.documents_by_sync_status
      expect(result).to be_an(Array)
      expect(result.first).to include("date", "pending", "error", "complete")
    end

    it "zero-fills weeks with no documents" do
      result = service.documents_by_sync_status
      expect(result.all? { |b| b["pending"] == 0 && b["error"] == 0 && b["complete"] == 0 }).to be true
    end

    it "counts documents by sync_status in the correct week bucket" do
      create_list(:document, 2, created_at: 1.week.ago).each { |d| d.update_column(:sync_status, :complete) }
      create(:document, created_at: 1.week.ago).update_column(:sync_status, :error)

      result = service.documents_by_sync_status
      bucket = result.find { |b| b["date"] == 1.week.ago.beginning_of_week.to_date.iso8601 }
      expect(bucket["complete"]).to eq(2)
      expect(bucket["error"]).to eq(1)
      expect(bucket["pending"]).to eq(0)
    end

    it "excludes documents outside the date range" do
      create(:document, sync_status: :complete, created_at: 10.weeks.ago)

      result = service.documents_by_sync_status
      expect(result.sum { |b| b["complete"] }).to eq(0)
    end
  end

  describe "#messages_by_state" do
    it "returns an array of buckets with date and state keys" do
      result = service.messages_by_state
      expect(result).to be_an(Array)
      expect(result.first).to include("date", "user_message", "bot_message", "knowledge_service_error")
    end

    it "counts messages by state in the correct week bucket" do
      create_list(:message, 3, :incoming, state: :user_message, created_at: 1.week.ago)
      create(:message, :outgoing, state: :bot_message, created_at: 1.week.ago)

      result = service.messages_by_state
      bucket = result.find { |b| b["date"] == 1.week.ago.beginning_of_week.to_date.iso8601 }
      expect(bucket["user_message"]).to eq(3)
      expect(bucket["bot_message"]).to eq(1)
    end

    it "excludes messages outside the date range" do
      create(:message, :incoming, state: :user_message, created_at: 10.weeks.ago)

      result = service.messages_by_state
      expect(result.sum { |b| b["user_message"] }).to eq(0)
    end
  end

  describe "#hubs_by_creation_date" do
    # Deleted hubs are read from audit.hubs_log, which other spec files leave real rows in; see hub_lifecycle_service_spec.rb
    before do
      ActiveRecord::Base.connection.execute("TRUNCATE audit.hubs_log")
    end

    def hard_delete_hub!(hub_id)
      ActiveRecord::Base.connection.execute(
        ActiveRecord::Base.sanitize_sql(["DELETE FROM hub_memberships WHERE hub_id = ?", hub_id])
      )
      ActiveRecord::Base.connection.execute(ActiveRecord::Base.sanitize_sql(["DELETE FROM hubs WHERE id = ?", hub_id]))
    end

    def bucket_for(result, time)
      result.find { |b| b["date"] == time.beginning_of_week.to_date.iso8601 }
    end

    def creation_dates
      HubLifecycleService.new.creation_dates
    end

    it "returns zero-filled buckets with date, active, and deleted keys" do
      result = service.hubs_by_creation_date(creation_dates)
      expect(result).to be_an(Array)
      expect(result).to all(include("date", "active" => 0, "deleted" => 0))
    end

    it "supports group_by: day" do
      create(:hub, created_at: 2.days.ago)

      result = PlatformStatisticsService.new(group_by: "day").hubs_by_creation_date(creation_dates)
      bucket = result.find { |b| b["date"] == 2.days.ago.to_date.iso8601 }
      expect(bucket["active"]).to eq(1)
    end

    it "counts newly created hubs in the correct week bucket" do
      create_list(:hub, 2, created_at: 1.week.ago)
      deleted = create(:hub, created_at: 1.week.ago)
      hard_delete_hub!(deleted.id)

      bucket = bucket_for(service.hubs_by_creation_date(creation_dates), 1.week.ago)
      expect(bucket["active"]).to eq(2)
      expect(bucket["deleted"]).to eq(1)
    end

    it "does not mutate a past week count if a hub belonging to that bucket no longer exists" do
      hub = create(:hub, created_at: 2.weeks.ago)
      before_deletion = bucket_for(PlatformStatisticsService.new.hubs_by_creation_date(creation_dates), 2.weeks.ago)

      hard_delete_hub!(hub.id)
      after_deletion = bucket_for(PlatformStatisticsService.new.hubs_by_creation_date(creation_dates), 2.weeks.ago)

      expect(before_deletion.values_at("active", "deleted")).to eq([1, 0])
      expect(after_deletion.values_at("active", "deleted")).to eq([0, 1])
    end

    it "only counts a hub once" do
      updated = create(:hub, created_at: 1.week.ago)
      updated.update!(name: "Renamed")
      updated.update!(name: "Renamed again")
      deleted = create(:hub, created_at: 1.week.ago)
      deleted.update!(name: "Renamed before deletion")
      hard_delete_hub!(deleted.id)

      result = service.hubs_by_creation_date(creation_dates)
      expect(result.sum { |b| b["active"] }).to eq(1)
      expect(result.sum { |b| b["deleted"] }).to eq(1)
    end

    it "excludes hubs outside of the date range" do
      create(:hub, created_at: 10.weeks.ago)
      deleted = create(:hub, created_at: 10.weeks.ago)
      hard_delete_hub!(deleted.id)

      result = service.hubs_by_creation_date(creation_dates)
      expect(result.sum { |b| b["active"] + b["deleted"] }).to eq(0)
    end

    it "buckets whatever creation_dates hash it's given" do
      bucket = bucket_for(service.hubs_by_creation_date({active: [1.week.ago], deleted: [1.week.ago]}), 1.week.ago)
      expect(bucket).to include("active" => 1, "deleted" => 1)
    end
  end

  describe "#questions_by_answered" do
    def question(answered:, at: 1.week.ago, external: true)
      incoming = create(:message, :incoming, created_at: at, external_id: external ? SecureRandom.hex : nil)
      create(:message, :outgoing, reply_to_id: incoming.id, answered: answered, created_at: at + 1.minute)
      incoming
    end

    it "returns an array of buckets with date, answered, and unanswered keys" do
      result = service.questions_by_answered
      expect(result).to be_an(Array)
      expect(result.first).to include("date", "answered", "unanswered")
    end

    it "counts only end-user questions the bot replied to" do
      question(answered: true)
      question(answered: true, external: false)
      create(:message, :outgoing, created_at: 1.week.ago)

      expect(service.questions_by_answered.sum { |b| b["answered"] + b["unanswered"] }).to eq(1)
    end

    it "correctly splits answered and unanswered in the right bucket" do
      question(answered: true)
      question(answered: false)

      bucket = service.questions_by_answered.find { |b| b["date"] == 1.week.ago.beginning_of_week.to_date.iso8601 }
      expect(bucket["answered"]).to eq(1)
      expect(bucket["unanswered"]).to eq(1)
    end

    it "leaves out replies that never carried an answered verdict" do
      question(answered: nil)

      expect(service.questions_by_answered.sum { |b| b["unanswered"] }).to eq(0)
    end

    it "buckets by when the question was asked, not when it was answered" do
      asked = 1.week.ago.end_of_week - 1.hour
      incoming = create(:message, :incoming, created_at: asked, external_id: SecureRandom.hex)
      create(:message, :outgoing, reply_to_id: incoming.id, answered: true, created_at: asked + 2.hours)

      bucket = service.questions_by_answered.find { |b| b["date"] == asked.beginning_of_week.to_date.iso8601 }
      expect(bucket["answered"]).to eq(1)
    end
  end

  describe "#average_answer_times" do
    it "returns nil values when there are no qualifying messages" do
      result = service.average_answer_times
      expect(result["all_time"]).to be_nil
    end

    it "returns the correct structure with all periods" do
      result = service.average_answer_times
      expect(result.keys).to match_array(%w[all_time last_week last_month])
    end

    it "returns the average total_duration_ms for outgoing reply messages" do
      question1 = create(:message, :incoming)
      question2 = create(:message, :incoming)
      create(:message, :outgoing, reply_to_id: question1.id, answered: true, metadata: {"total_duration_ms" => 1000.0})
      create(:message, :outgoing, reply_to_id: question2.id, answered: false, metadata: {"total_duration_ms" => 3000.0})

      result = service.average_answer_times
      expect(result["all_time"]).to be_within(0.1).of(2000.0)
    end

    it "filters by time period" do
      question_old = create(:message, :incoming, created_at: 2.months.ago)
      question_recent = create(:message, :incoming, created_at: 3.days.ago)
      create(:message, :outgoing, reply_to_id: question_old.id, answered: true, metadata: {"total_duration_ms" => 1000.0}, created_at: 2.months.ago)
      create(:message, :outgoing, reply_to_id: question_recent.id, answered: true, metadata: {"total_duration_ms" => 5000.0}, created_at: 3.days.ago)

      result = service.average_answer_times
      expect(result["all_time"]).to be_within(0.1).of(3000.0)
      expect(result["last_week"]).to be_within(0.1).of(5000.0)
      expect(result["last_month"]).to be_within(0.1).of(5000.0)
    end

    it "excludes messages without reply_to_id" do
      create(:message, :outgoing, metadata: {"total_duration_ms" => 500.0})

      result = service.average_answer_times
      expect(result["all_time"]).to be_nil
    end
  end

  describe "#global_counts" do
    it "returns counts for all expected keys" do
      result = service.global_counts
      expect(result.keys).to match_array(%i[hubs sources conversations users external_users documents messages])
    end

    it "reflects the current record counts" do
      create(:hub)
      source = create(:source)
      create(:document, source: source)

      result = service.global_counts
      expect(result[:hubs]).to eq(Hub.count)
      expect(result[:sources]).to eq(Source.count)
      expect(result[:documents]).to eq(Document.count)
    end
  end
end
