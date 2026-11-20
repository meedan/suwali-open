require "rails_helper"

RSpec.describe StatisticsService, type: :service do
  let(:hub) { create(:hub) }
  let(:from) { 3.months.ago.beginning_of_day }
  let(:to) { Time.now.end_of_day }
  let(:service) { StatisticsService.new(hub, from, to) }

  describe "#initialize" do
    it "sets the hub" do
      expect(service.instance_variable_get(:@hub)).to eq(hub)
    end

    it "sets default from date to 3 months ago when not provided" do
      service = StatisticsService.new(hub)
      expect(service.instance_variable_get(:@from)).to be_within(1.second).of(3.months.ago.beginning_of_day)
    end

    it "sets default to date to now when not provided" do
      service = StatisticsService.new(hub)
      expect(service.instance_variable_get(:@to)).to be_within(1.second).of(Time.now.end_of_day)
    end

    it "accepts custom from and to dates" do
      custom_from = 1.month.ago
      custom_to = 1.day.ago
      service = StatisticsService.new(hub, custom_from, custom_to)
      expect(service.instance_variable_get(:@from)).to eq(custom_from)
      expect(service.instance_variable_get(:@to)).to eq(custom_to)
    end

    it "clamps from when the requested range exceeds the maximum allowed span" do
      custom_to = Time.now.end_of_day
      custom_from = custom_to - 3.years

      service = StatisticsService.new(hub, custom_from, custom_to)

      expect(service.range.first).to be_within(1.second).of(custom_to - DateBucketing::MAX_DATE_RANGE)
    end

    it "logs when the date range is clamped" do
      custom_to = Time.now.end_of_day
      custom_from = custom_to - 3.years

      expect(LogService).to receive(:log).with(:info, "StatisticsService", a_string_matching(/clamp/i))

      StatisticsService.new(hub, custom_from, custom_to)
    end

    it "does not clamp or log when the requested range is within the maximum allowed span" do
      expect(LogService).not_to receive(:log)

      service = StatisticsService.new(hub, from, to)

      expect(service.range.first).to eq(from)
    end
  end

  describe "#range" do
    it "returns an array with from and to dates" do
      expect(service.range).to eq([from, to])
    end
  end

  describe "#dashboard" do
    before do
      allow(service).to receive(:total_conversations).and_return(10)
      allow(service).to receive(:number_of_received_messages).and_return({"2025-01-01" => 5})
      allow(service).to receive(:number_of_new_conversations).and_return({"2025-01-01" => 3})
      allow(service).to receive(:number_of_continued_conversations).and_return({"2025-01-01" => 2})
    end

    it "returns a hash with dashboard statistics" do
      result = service.dashboard
      expect(result).to include(
        range: [from, to],
        total_conversations: 10,
        number_of_received_messages: {"2025-01-01" => 5},
        number_of_new_conversations: {"2025-01-01" => 3},
        number_of_continued_conversations: {"2025-01-01" => 2}
      )
    end
  end

  describe "#total_conversations" do
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub) }
    let!(:conversation2) { create(:conversation, platform: "telegram", hub: hub) }
    let!(:internal_conversation) { create(:conversation, platform: "internal", hub: hub) }
    let!(:other_hub_conversation) { create(:conversation, platform: "whatsapp", hub: create(:hub)) }

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

    it "counts conversation-days (distinct conversation-day pairs) within the date range" do
      # Conversation 1: messages on 2 different days = 2 conversation-days
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day)
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day + 1.hour)
      create(:message, :incoming, conversation: conversation1, created_at: from + 2.days)

      # Conversation 2: messages on 1 day = 1 conversation-day
      create(:message, :incoming, conversation: conversation2, created_at: from + 3.days)

      # Total: 2 + 1 = 3 conversation-days
      expect(service.total_conversations).to eq(3)
    end

    it "excludes internal platform conversations" do
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day)
      create(:message, :incoming, conversation: internal_conversation, created_at: from + 1.day)

      expect(service.total_conversations).to eq(1)
    end

    it "excludes soft-deleted conversations" do
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day)
      create(:message, :incoming, conversation: conversation2, created_at: from + 1.day)
      conversation1.update!(deleted_at: Time.current)

      expect(service.total_conversations).to eq(1)
    end

    it "excludes conversations from other hubs" do
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day)
      create(:message, :incoming, conversation: other_hub_conversation, created_at: from + 1.day)

      expect(service.total_conversations).to eq(1)
    end

    it "only counts messages within the date range" do
      # Message before range
      create(:message, :incoming, conversation: conversation1, created_at: from - 1.day)
      # Message within range
      create(:message, :incoming, conversation: conversation1, created_at: from + 1.day)
      # Message after range
      create(:message, :incoming, conversation: conversation1, created_at: to + 1.day)

      expect(service.total_conversations).to eq(1)
    end

    it "returns 0 when no messages exist in the range" do
      create(:message, :incoming, conversation: conversation1, created_at: from - 1.day)

      expect(service.total_conversations).to eq(0)
    end
  end

  describe "#number_of_received_messages" do
    let!(:conversation) { create(:conversation, platform: "whatsapp", hub: hub) }
    let!(:message1) { create(:message, conversation: conversation, direction: "incoming", created_at: from + 1.day) }
    let!(:message2) { create(:message, conversation: conversation, direction: "incoming", created_at: from + 1.day) }
    let!(:message3) { create(:message, conversation: conversation, direction: "incoming", created_at: from + 2.days) }
    let!(:outgoing_message) { create(:message, conversation: conversation, direction: "outgoing", created_at: from + 1.day) }

    it "returns messages grouped by day" do
      result = service.number_of_received_messages
      date1 = (from + 1.day).to_date.iso8601
      date2 = (from + 2.days).to_date.iso8601
      expect(result[date1]).to eq(2)
      expect(result[date2]).to eq(1)
    end

    it "excludes messages in soft-deleted conversations" do
      conversation.update!(deleted_at: Time.current)

      expect(service.number_of_received_messages.values.sum).to eq(0)
    end

    it "only counts incoming messages" do
      result = service.number_of_received_messages
      total_messages = result.values.sum
      expect(total_messages).to eq(3)
    end

    it "includes days with zero messages in the range" do
      result = service.number_of_received_messages
      expect(result.keys.size).to eq((to.to_date - from.to_date).to_i + 1)
      expect(result.values).to include(0)
    end
  end

  describe "#number_of_continued_conversations" do
    let!(:participant1) { create(:external_user) }
    let!(:participant2) { create(:external_user) }
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub, participant: participant1) }
    let!(:conversation2) { create(:conversation, platform: "whatsapp", hub: hub, participant: participant2) }
    let!(:message1) { create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day) }
    let!(:message2) { create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day) }
    let!(:message3) { create(:message, conversation: conversation2, direction: "incoming", created_at: from + 1.day) }

    it "counts distinct participants per day" do
      result = service.number_of_continued_conversations
      date = (from + 1.day).to_date.iso8601
      expect(result[date]).to eq(2)
    end

    it "excludes participants whose conversation is soft-deleted" do
      conversation1.update!(deleted_at: Time.current)

      result = service.number_of_continued_conversations

      expect(result[(from + 1.day).to_date.iso8601]).to eq(1)
    end

    it "does not double count the same participant on the same day" do
      result = service.number_of_continued_conversations
      date = (from + 1.day).to_date.iso8601
      expect(result[date]).to eq(2)
    end

    it "includes days with zero continued conversations in the range" do
      result = service.number_of_continued_conversations
      expect(result.keys.size).to eq((to.to_date - from.to_date).to_i + 1)
    end
  end

  describe "#number_of_new_conversations" do
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day) }
    let!(:conversation2) { create(:conversation, platform: "telegram", hub: hub, created_at: from + 1.day) }
    let!(:conversation3) { create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 2.days) }
    let!(:internal_conversation) { create(:conversation, platform: "internal", hub: hub, created_at: from + 1.day) }

    it "returns new conversations grouped by day" do
      result = service.number_of_new_conversations
      date1 = (from + 1.day).to_date.iso8601
      date2 = (from + 2.days).to_date.iso8601
      expect(result[date1]).to eq(2)
      expect(result[date2]).to eq(1)
    end

    it "excludes soft-deleted conversations" do
      conversation1.update!(deleted_at: Time.current)

      expect(service.number_of_new_conversations.values.sum).to eq(2)
    end

    it "excludes internal platform conversations" do
      result = service.number_of_new_conversations
      total_conversations = result.values.sum
      expect(total_conversations).to eq(3)
    end

    it "includes days with zero new conversations in the range" do
      result = service.number_of_new_conversations
      expect(result.keys.size).to eq((to.to_date - from.to_date).to_i + 1)
      expect(result.values).to include(0)
    end
  end

  describe "#contributions_by_contributor" do
    let(:from) { 3.weeks.ago.beginning_of_week }
    let(:to) { Time.now.end_of_day }
    let(:service) { StatisticsService.new(hub, from, to, group_by: "week") }
    let(:latest_bucket) { Time.now.beginning_of_week }
    let(:user1) { create(:conversation, :external, hub: hub) }
    let(:user2) { create(:conversation, :external, hub: hub) }

    def contribution(at:, from_conversation: user1, in_hub: hub)
      message = create(:message, :incoming, conversation: from_conversation, created_at: at)
      create(:contribution, message: message, hub: in_hub, created_at: at)
    end

    it "returns one zero-filled row per bucket, splitting each end-user's first contribution out" do
      contribution(at: from + 1.day)
      2.times { contribution(at: latest_bucket + 1.hour) }
      contribution(at: latest_bucket + 2.hours, from_conversation: user2)

      result = service.contributions_by_contributor

      expect(result.size).to eq(4)
      expect(result.first).to eq({"date" => from.to_date.iso8601, "new" => 1, "returning" => 0})
      expect(result.last).to eq({"date" => latest_bucket.to_date.iso8601, "new" => 1, "returning" => 2})
      expect(result.map { |row| row["date"] }).to all(satisfy { |date| Date.parse(date).monday? })
    end

    it "counts a contributor as returning when their first contribution predates the range" do
      contribution(at: from - 1.week)
      contribution(at: latest_bucket + 1.hour)

      expect(service.contributions_by_contributor.last).to eq({"date" => latest_bucket.to_date.iso8601, "new" => 0, "returning" => 1})
    end

    it "counts nothing for other hubs" do
      contribution(at: latest_bucket + 1.hour, from_conversation: create(:conversation, :external, hub: create(:hub)), in_hub: create(:hub))

      totals = service.contributions_by_contributor.sum { |row| row["new"] + row["returning"] }

      expect(totals).to eq(0)
    end
  end

  describe "#questions_by_answered" do
    let(:from) { 3.weeks.ago.beginning_of_week }
    let(:to) { Time.now.end_of_day }
    let(:service) { StatisticsService.new(hub, from, to, group_by: "week") }
    let(:latest_bucket) { Time.now.beginning_of_week }
    let(:conversation) { create(:conversation, platform: "whatsapp", hub: hub) }

    def question(answered:, at: latest_bucket + 1.hour, in_conversation: conversation)
      incoming = create(:message, :incoming, conversation: in_conversation, external_id: SecureRandom.hex, created_at: at)
      create(:message, :outgoing, conversation: in_conversation, state: :bot_message, reply_to: incoming, answered: answered, created_at: at + 1.minute)
      incoming
    end

    it "returns one zero-filled row per bucket, split by whether the reply answered the question" do
      2.times { question(answered: false) }
      question(answered: true)
      question(answered: true, at: from + 1.day)

      result = service.questions_by_answered

      expect(result.size).to eq(4)
      expect(result.first).to eq({"date" => from.to_date.iso8601, "answered" => 1, "unanswered" => 0})
      expect(result.last).to eq({"date" => latest_bucket.to_date.iso8601, "answered" => 1, "unanswered" => 2})
      expect(result.map { |row| row["date"] }).to all(satisfy { |date| Date.parse(date).monday? })
    end

    it "leaves out replies that never carried an answered verdict, so the ranking can name what it counts" do
      # Small talk the bot recognised as a non-question, and a Knowledge Service failure
      [:non_question_reply, :knowledge_service_error].each do |state|
        incoming = create(:message, :incoming, conversation: conversation, external_id: SecureRandom.hex, created_at: latest_bucket + 1.hour)
        create(:message, :outgoing, conversation: conversation, state: state, reply_to: incoming, answered: nil, created_at: latest_bucket + 2.hours)
      end
      question(answered: false)

      expect(service.questions_by_answered.last).to eq({"date" => latest_bucket.to_date.iso8601, "answered" => 0, "unanswered" => 1})
    end

    it "counts nothing for questions in soft-deleted conversations" do
      question(answered: true)
      conversation.update!(deleted_at: Time.current)

      totals = service.questions_by_answered.sum { |row| row["answered"] + row["unanswered"] }

      expect(totals).to eq(0)
    end

    it "counts nothing for other hubs, internal conversations, or questions the bot never replied to" do
      question(answered: false, in_conversation: create(:conversation, platform: "whatsapp", hub: create(:hub)))
      question(answered: false, in_conversation: create(:conversation, platform: "internal", hub: hub))
      question(answered: false, at: from - 1.week)
      create(:message, :incoming, conversation: conversation, external_id: SecureRandom.hex, created_at: latest_bucket + 1.hour)

      totals = service.questions_by_answered.sum { |row| row["answered"] + row["unanswered"] }

      expect(totals).to eq(0)
    end
  end

  describe "#top_topics" do
    let(:from) { 4.weeks.ago.beginning_of_week }
    let(:to) { Time.now.end_of_day }
    let(:service) { StatisticsService.new(hub, from, to, group_by: "week") }
    let(:latest_bucket) { Time.now.beginning_of_week }
    let(:deepfakes) { create(:topic, hub: hub, name: "Deepfake detection") }
    let(:vaccines) { create(:topic, hub: hub, name: "Vaccines") }

    # Only answered questions count, so every question needs a reply the bot managed to send
    def message_about(topic, at, target_hub = hub)
      conversation = create(:conversation, platform: "whatsapp", hub: target_hub)
      message = create(:message, :incoming, conversation: conversation, created_at: at)
      create(:topic_item, topic: topic, item: message)
      create(:message, :outgoing, conversation: conversation, reply_to: message, answered: true, created_at: at + 1.minute)
      message
    end

    def answer(question, *items)
      items.each { |item| create(:message_data_source_item, message: question.reply, item: item) }
      question.reply
    end

    def data_source(topic = nil)
      document = create(:document, source: create(:source, hub: hub))
      create(:topic_item, topic: topic, item: document) if topic
      document
    end

    it "ranks topics by the whole range and zero-fills every series" do
      2.times { message_about(deepfakes, latest_bucket + 1.hour) }
      message_about(deepfakes, from + 1.day)
      3.times { message_about(vaccines, from + 1.day) }
      message_about(vaccines, latest_bucket + 1.hour)

      result = service.top_topics
      deepfakes_result = result.find { |topic| topic[:name] == "Deepfake detection" }

      expect(result.map { |topic| topic[:name] }).to eq(["Vaccines", "Deepfake detection"])
      expect(deepfakes_result[:messages][latest_bucket.to_date.iso8601]).to eq(2)
      expect(deepfakes_result[:messages][from.to_date.iso8601]).to eq(1)
      expect(deepfakes_result[:messages].keys.size).to eq(5)
      expect(deepfakes_result[:messages].keys).to all(satisfy { |key| Date.parse(key).monday? })
    end

    it "leaves out topics asked about only in soft-deleted conversations" do
      message_about(deepfakes, latest_bucket + 1.hour)
      message_about(vaccines, latest_bucket + 1.hour).conversation.update!(deleted_at: Time.current)

      expect(service.top_topics.map { |topic| topic[:name] }).to eq(["Deepfake detection"])
    end

    it "includes topics asked about earlier in the range, not only in the latest bucket" do
      message_about(deepfakes, latest_bucket + 1.hour)
      message_about(vaccines, from + 1.day)

      expect(service.top_topics.map { |topic| topic[:name] }).to contain_exactly("Deepfake detection", "Vaccines")
    end

    it "counts every data source item that answered this topic's messages, however it is tagged" do
      cited_twice = data_source(deepfakes)
      answer(message_about(deepfakes, latest_bucket + 1.hour), cited_twice, data_source(deepfakes), data_source)
      answer(message_about(deepfakes, latest_bucket + 2.hours), cited_twice)
      # Answered a message about a different topic
      answer(message_about(vaccines, latest_bucket + 1.hour), data_source(deepfakes))
      # Never cited
      data_source(deepfakes)

      series = service.top_topics.first[:data_source_items]

      expect(series[latest_bucket.to_date.iso8601]).to eq(3)
      expect(series[from.to_date.iso8601]).to eq(0)
    end

    it "excludes messages from other hubs and outside the range" do
      other_hub = create(:hub)
      message_about(deepfakes, latest_bucket + 1.hour)
      message_about(create(:topic, hub: other_hub, name: "Deepfake detection"), latest_bucket + 1.hour, other_hub)
      message_about(vaccines, from - 1.week)

      result = service.top_topics

      expect(result.size).to eq(1)
      expect(result.first[:messages][latest_bucket.to_date.iso8601]).to eq(1)
    end

    it "returns at most the requested number of topics" do
      message_about(deepfakes, latest_bucket + 1.hour)
      message_about(vaccines, latest_bucket + 1.hour)

      expect(service.top_topics(1).size).to eq(1)
      expect(StatisticsService.new(hub, from, to, group_by: "week", limit: "1").top_topics.size).to eq(1)
    end

    describe "with group_by set to range" do
      let(:service) { StatisticsService.new(hub, from, to, group_by: "range") }

      it "collapses the whole period into one bucket and counts items distinctly across it" do
        shared = data_source(deepfakes)
        answer(message_about(deepfakes, from + 1.day), shared)
        # Same item, different week: summing per-week buckets would double count it
        answer(message_about(deepfakes, latest_bucket + 1.hour), shared, data_source(deepfakes))
        # Silent in the latest week, but still active in the range
        message_about(vaccines, from + 1.day)

        result = service.top_topics
        deepfakes_result = result.find { |topic| topic[:name] == "Deepfake detection" }

        expect(result.map { |topic| topic[:name] }).to eq(["Deepfake detection", "Vaccines"])
        expect(deepfakes_result[:messages]).to eq({from.to_date.iso8601 => 2})
        expect(deepfakes_result[:data_source_items]).to eq({from.to_date.iso8601 => 2})
      end
    end
  end

  describe "#subscribed_topics" do
    let(:from) { 4.weeks.ago.beginning_of_week }
    let(:to) { Time.now.end_of_day }
    let(:service) { StatisticsService.new(hub, from, to, group_by: "week") }
    let(:latest_bucket) { Time.now.beginning_of_week }
    let(:deepfakes) { create(:topic, hub: hub, name: "Deepfake detection") }
    let(:vaccines) { create(:topic, hub: hub, name: "Vaccines") }
    let(:public_source) { create(:source, hub: hub, source_type: :rss_feed) }

    def subscribe(topic, count = 1, target_hub = hub)
      count.times { create(:topic_subscription, topic: topic, external_user: create(:external_user, hub: target_hub, external_id: SecureRandom.hex)) }
    end

    def document_about(topic, at, source: public_source, active: true)
      document = create(:document, source: source, active: active)
      create(:topic_item, topic: topic, item: document, created_at: at)
    end

    it "ranks topics by subscriber count and zero-fills the document series" do
      subscribe(deepfakes, 3)
      subscribe(vaccines, 1)
      document_about(deepfakes, latest_bucket + 1.hour)
      document_about(deepfakes, from + 1.day)

      result = service.subscribed_topics

      expect(result.map { |topic| topic[:name] }).to eq(["Deepfake detection", "Vaccines"])
      expect(result.first[:subscribers]).to eq(3)
      expect(result.first[:documents][latest_bucket.to_date.iso8601]).to eq(1)
      expect(result.first[:documents][from.to_date.iso8601]).to eq(1)
      expect(result.first[:documents].keys.size).to eq(5)
      expect(result.first[:documents].keys).to all(satisfy { |key| Date.parse(key).monday? })
      expect(result.last[:documents].values).to all(eq(0))
    end

    it "counts every subscriber, including those who subscribed before the range" do
      subscribe(deepfakes)
      TopicSubscription.update_all(created_at: from - 1.year)

      expect(service.subscribed_topics.first[:subscribers]).to eq(1)
    end

    it "excludes topics nobody is subscribed to" do
      subscribe(deepfakes)
      document_about(vaccines, latest_bucket + 1.hour)

      expect(service.subscribed_topics.map { |topic| topic[:name] }).to eq(["Deepfake detection"])
    end

    it "only counts documents that notify subscribers" do
      subscribe(deepfakes)
      document_about(deepfakes, latest_bucket + 1.hour)
      document_about(deepfakes, latest_bucket + 2.hours, source: create(:source, hub: hub, source_type: :google_drive_folder))
      document_about(deepfakes, latest_bucket + 3.hours, active: false)
      create(:topic_item, topic: deepfakes, item: create(:notebook, hub: hub), created_at: latest_bucket + 4.hours)

      expect(service.subscribed_topics.first[:documents][latest_bucket.to_date.iso8601]).to eq(1)
    end

    it "excludes documents added outside the range" do
      subscribe(deepfakes)
      document_about(deepfakes, from - 1.week)

      expect(service.subscribed_topics.first[:documents].values).to all(eq(0))
    end

    it "excludes topics, subscribers and documents from other hubs" do
      other_hub = create(:hub)
      subscribe(create(:topic, hub: other_hub, name: "Deepfake detection"), 5, other_hub)
      subscribe(deepfakes)
      other_document = create(:document, source: create(:source, hub: other_hub, source_type: :rss_feed))
      # Only a validation keeps a foreign hub's document off this topic, so bypass it to prove the
      # query does not rely on that validation having held
      TopicItem.new(topic: deepfakes, item: other_document, created_at: latest_bucket + 1.hour).save(validate: false)

      result = service.subscribed_topics

      expect(result.size).to eq(1)
      expect(result.first[:subscribers]).to eq(1)
      expect(result.first[:documents].values).to all(eq(0))
    end

    it "returns at most the requested number of topics" do
      subscribe(deepfakes)
      subscribe(vaccines)

      expect(service.subscribed_topics(1).size).to eq(1)
      expect(StatisticsService.new(hub, from, to, group_by: "week", limit: "1").subscribed_topics.size).to eq(1)
    end
  end

  describe "grouping by week or month" do
    let(:from) { 4.weeks.ago.beginning_of_week }
    let(:to) { Time.now.end_of_day }
    let(:service) { StatisticsService.new(hub, from, to, group_by: "week") }

    it "returns one bucket per week, keyed by the day the week starts on" do
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day)
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 2.days)
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.week + 1.day)

      result = service.number_of_new_conversations

      expect(result[from.to_date.iso8601]).to eq(2)
      expect(result[(from + 1.week).to_date.iso8601]).to eq(1)
      expect(result.keys).to all(satisfy { |key| Date.parse(key).monday? })
    end

    it "groups by month when asked" do
      service = StatisticsService.new(hub, 2.months.ago.beginning_of_month, to, group_by: "month")
      create(:conversation, platform: "whatsapp", hub: hub, created_at: 1.month.ago)

      result = service.number_of_new_conversations

      expect(result.keys).to all(satisfy { |key| Date.parse(key).day == 1 })
      expect(result[1.month.ago.beginning_of_month.to_date.iso8601]).to eq(1)
    end

    it "returns the whole period as a single bucket when grouping by range" do
      service = StatisticsService.new(hub, from, to, group_by: "range")
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day)
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 2.weeks)

      expect(service.number_of_new_conversations).to eq({from.to_date.iso8601 => 2})
    end

    it "counts seven-day buckets from the start of the window when grouping by rolling_week" do
      # A Wednesday, so calendar weeks would split these differently
      from = Date.parse("2026-06-17").beginning_of_day
      to = (from + 27.days).end_of_day
      service = StatisticsService.new(hub, from, to, group_by: "rolling_week")
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from)
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 6.days)
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 7.days)

      result = service.number_of_new_conversations

      expect(result.keys).to eq(["2026-06-17", "2026-06-24", "2026-07-01", "2026-07-08"])
      expect(result["2026-06-17"]).to eq(2)
      expect(result["2026-06-24"]).to eq(1)
    end

    it "falls back to daily grouping for an unknown group_by" do
      service = StatisticsService.new(hub, from, to, group_by: "fortnight")
      expect(service.number_of_new_conversations.keys.size).to eq((to.to_date - from.to_date).to_i + 1)
    end
  end

  describe "#by_bucket (private method)" do
    let!(:conversation) { create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day) }

    it "groups records by day within the date range" do
      result = service.send(:by_bucket, service.send(:conversations_query), "created_at")
      expect(result).to be_a(Hash)
      expect(result.keys).to all(match(/\d{4}-\d{2}-\d{2}/))
    end

    it "fills in missing days with zero counts" do
      result = service.send(:by_bucket, service.send(:conversations_query), "created_at")
      expect(result.keys.size).to eq((to.to_date - from.to_date).to_i + 1)
      expect(result.values).to include(0)
    end

    it "accepts custom count parameter" do
      create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day)
      result = service.send(:by_bucket, service.send(:conversations_query), "created_at", "id")
      expect(result.values.sum).to be > 0
    end
  end

  describe "#message_data_source_items_ranking" do
    let(:conversation) { create(:conversation, platform: "whatsapp", hub: hub) }
    let(:source) { create(:source, hub: hub) }
    let(:document) { create(:document, title: "Document A", source: source) }
    let(:notebook) { create(:notebook, title: "Notebook B", hub: hub) }
    let(:contribution) { create(:contribution, content: "Contribution C", hub: hub) }

    def message_data_source_item(item, items = 1)
      items.times { create(:message_data_source_item, item: item, message: create(:message, direction: :outgoing, conversation: conversation)) }
    end

    before do
      message_data_source_item(document, 2)
      message_data_source_item(notebook)
      message_data_source_item(contribution)
    end

    it "returns both: items ranked by usage count with title and type; and the total item count" do
      mdsi_ranking, total_count = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(
        have_attributes(item_type: "Document", item_title: "Document A", usage_count: 2),
        have_attributes(item_type: "Contribution", item_title: "Contribution C", usage_count: 1),
        have_attributes(item_type: "Notebook", item_title: "Notebook B", usage_count: 1)
      )

      expect(total_count).to eq(3)
    end

    it "excludes items cited in soft-deleted conversations" do
      conversation.update!(deleted_at: Time.current)

      mdsi_ranking, total_count = service.message_data_source_items_ranking

      expect(mdsi_ranking).to be_empty
      expect(total_count).to eq(0)
    end

    it "does not rank and count items from a different hub" do
      other_hub = create(:hub)
      other_conversation = create(:conversation, platform: "whatsapp", hub: other_hub)
      other_message = create(:message, direction: :outgoing, conversation: other_conversation)
      other_contribution = create(:contribution, content: "Other Contribution", hub: other_hub)
      create(:message_data_source_item, item: other_contribution, message: other_message)

      mdsi_ranking, total_count = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(
        have_attributes(item_type: "Document", item_title: "Document A", usage_count: 2, active: true),
        have_attributes(item_type: "Contribution", item_title: "Contribution C", usage_count: 1, active: true),
        have_attributes(item_type: "Notebook", item_title: "Notebook B", usage_count: 1, active: true)
      )

      expect(total_count).to eq(3)
    end

    it "handles no message data source items gracefully" do
      MessageDataSourceItem.delete_all
      mdsi_ranking, total_count = service.message_data_source_items_ranking

      expect(mdsi_ranking).to be_empty
      expect(total_count).to eq(0)
    end

    it "includes the priority_tier for each item using its default value" do
      mdsi_ranking, _total = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(
        have_attributes(item_type: "Document", priority_tier: 1),
        have_attributes(item_type: "Notebook", priority_tier: 1),
        have_attributes(item_type: "Contribution", priority_tier: 2)
      )
    end

    it "reflects a non-default priority_tier on an item" do
      document.update!(priority_tier: 2)

      mdsi_ranking, _total = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(have_attributes(item_type: "Document", priority_tier: 2))
    end

    it "returns active: false when the item is paused" do
      document.update!(active: false)

      mdsi_ranking, _total = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(have_attributes(item_type: "Document", active: false))
    end

    it "returns active: nil when the source item has been hard-deleted" do
      document.destroy!

      mdsi_ranking, _total = service.message_data_source_items_ranking

      expect(mdsi_ranking).to include(have_attributes(item_type: "Document", active: nil))
    end
  end

  describe "#questions_ranking" do
    let(:conversation) { create(:conversation, hub: hub) }

    def create_questions_cluster(question_count:, answered:)
      cluster = create(:message_cluster, hub: hub)
      question_count.times do
        incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
        create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: incoming, answered: answered)
      end
      cluster
    end

    before do
      create_questions_cluster(question_count: 1, answered: true)
      create_questions_cluster(question_count: 5, answered: true)
      create_questions_cluster(question_count: 6, answered: true)
      create_questions_cluster(question_count: 3, answered: false)
      create_questions_cluster(question_count: 7, answered: false)
    end

    it "includes the last message body in the payload" do
      cluster = create(:message_cluster, hub: hub)
      incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, body: "last question")
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: incoming, answered: true)

      collection, = service.questions_ranking(true)
      result = collection.find { |c| c.id == cluster.id }

      expect(result.questions_ranking_payload[:last_message_body]).to eq("last question")
    end

    it "uses the last external message body, not an internal one" do
      cluster = create(:message_cluster, hub: hub)
      external_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, body: "external question")
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: external_incoming, answered: true)
      internal_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, body: "internal question")
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: internal_incoming, answered: true)

      collection, = service.questions_ranking(true)
      result = collection.find { |c| c.id == cluster.id }

      expect(result.questions_ranking_payload[:last_message_body]).to eq("external question")
    end

    it "returns answered clusters ordered by question_count descending, and the total count" do
      collection, total_count = service.questions_ranking(true)

      expect(collection.pluck(:question_count)).to eq([6, 5, 1])
      expect(total_count).to eq(3)
    end

    it "returns unanswered clusters ordered by question_count descending, and the total count" do
      collection, total_count = service.questions_ranking(false)

      expect(collection.pluck(:question_count)).to eq([7, 3])
      expect(total_count).to eq(2)
    end

    it "excludes clusters where no message has a bot reply" do
      unanswered_cluster = create(:message_cluster, hub: hub, question_count: 10)
      create(:message, :incoming, conversation: conversation, message_cluster: unanswered_cluster)

      collection, = service.questions_ranking(true)
      expect(collection).not_to include(unanswered_cluster)
    end

    context "when a conversation is soft-deleted" do
      def ask(conv, cluster, answered:)
        incoming = create(:message, :incoming, conversation: conv, message_cluster: cluster, external_id: SecureRandom.hex)
        create(:message, :outgoing, conversation: conv, state: :bot_message, reply_to: incoming, answered: answered)
      end

      def ask_in_soft_deleted_conversation(cluster, answered:)
        deleted = create(:conversation, hub: hub)
        ask(deleted, cluster, answered: answered)
        deleted.update!(deleted_at: Time.current)
      end

      it "excludes a cluster whose messages are all in soft-deleted conversations" do
        cluster = create(:message_cluster, hub: hub)
        ask_in_soft_deleted_conversation(cluster, answered: false)

        collection, = service.questions_ranking(false)

        expect(collection).not_to include(cluster)
      end

      it "counts only the messages in live conversations" do
        cluster = create(:message_cluster, hub: hub)
        ask(conversation, cluster, answered: false)
        ask_in_soft_deleted_conversation(cluster, answered: false)

        collection, = service.questions_ranking(false)

        expect(collection.find { |c| c.id == cluster.id }.question_count).to eq(1)
      end

      it "decides the answered status from live messages only" do
        cluster = create(:message_cluster, hub: hub)
        ask(conversation, cluster, answered: true)
        travel_to(1.minute.from_now) { ask_in_soft_deleted_conversation(cluster, answered: false) }

        answered, = service.questions_ranking(true)
        unanswered, = service.questions_ranking(false)

        expect(answered).to include(cluster)
        expect(unanswered).not_to include(cluster)
      end
    end

    it "excludes clusters from other hubs" do
      other_hub = create(:hub)
      other_conversation = create(:conversation, hub: other_hub)
      other_cluster = create(:message_cluster, hub: other_hub, question_count: 100)
      other_incoming = create(:message, :incoming, conversation: other_conversation, message_cluster: other_cluster)
      create(:message, :outgoing, conversation: other_conversation, reply_to: other_incoming, answered: true)

      collection, = service.questions_ranking(true)
      expect(collection).not_to include(other_cluster)
    end

    it "excludes clusters where incoming messages have no external_id" do
      internal_cluster = create(:message_cluster, hub: hub, question_count: 10)
      internal_incoming = create(:message, :incoming, conversation: conversation, message_cluster: internal_cluster)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: internal_incoming, answered: true)

      collection, = service.questions_ranking(true)
      expect(collection).not_to include(internal_cluster)
    end

    it "filters by the answered status of the last message in the cluster" do
      cluster = create(:message_cluster, hub: hub)
      answered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: answered_incoming, answered: true)
      unanswered_incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex)
      create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: unanswered_incoming, answered: false)

      answered_collection, = service.questions_ranking(true)
      unanswered_collection, = service.questions_ranking(false)

      expect(answered_collection).not_to include(cluster)
      expect(unanswered_collection).to include(cluster)
    end

    it "returns empty collection and zero count when no clusters have bot replies" do
      # whether it was answered or not, it will have a bot reply
      MessageCluster.delete_all
      collection, total_count = service.questions_ranking(true)

      expect(collection).to be_empty
      expect(total_count).to eq(0)
    end

    describe "with a requested window" do
      let(:previous_week) { 1.week.ago.beginning_of_week + 1.day }
      let(:windowed) { StatisticsService.new(hub, previous_week.beginning_of_week, previous_week.end_of_week) }

      def ask(cluster, answered:, at: Time.now)
        incoming = create(:message, :incoming, conversation: conversation, message_cluster: cluster, external_id: SecureRandom.hex, created_at: at)
        create(:message, :outgoing, conversation: conversation, state: :bot_message, reply_to: incoming, answered: answered, created_at: at)
        incoming
      end

      it "ranks and counts only the questions asked inside the window" do
        cluster = create(:message_cluster, hub: hub)
        2.times { ask(cluster, answered: false, at: previous_week) }
        # Asked again after the window closed, so it must not add to the count
        ask(cluster, answered: false)

        collection, total_count = windowed.questions_ranking(false)

        expect(collection.map(&:id)).to eq([cluster.id])
        expect(collection.pluck(:question_count)).to eq([2])
        expect(total_count).to eq(1)
      end

      it "takes the answered status from the last message inside the window" do
        cluster = create(:message_cluster, hub: hub)
        ask(cluster, answered: false, at: previous_week)
        # Answered when asked again later, which must not change the week being reported on
        ask(cluster, answered: true)

        expect(windowed.questions_ranking(false).first.map(&:id)).to include(cluster.id)
        expect(service.questions_ranking(false).first.map(&:id)).not_to include(cluster.id)
      end

      it "covers the hub's whole history when no window is requested" do
        cluster = create(:message_cluster, hub: hub)
        ask(cluster, answered: false, at: 2.years.ago)

        expect(StatisticsService.new(hub).questions_ranking(false).first.map(&:id)).to include(cluster.id)
        expect(service.questions_ranking(false).first.map(&:id)).not_to include(cluster.id)
      end
    end
  end

  describe "#average_timeout_window_interval" do
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day) }
    let!(:conversation2) { create(:conversation, platform: "telegram", hub: hub, created_at: from + 2.days) }

    it "calculates the average window duration across multiple conversations with multiple windows" do
      base_time = from + 1.day

      # Conversation 1
      # Window 1: 0min (first msg) -> 7min (last msg before timeout) = 7 minutes
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 4.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 7.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 12.minutes)

      # Window 2: 21min (first msg after timeout) -> 25min (last msg before timeout) = 4 minutes
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 21.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 23.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 25.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 30.minutes)

      # Window 3: 37min (first msg) -> 38min (last msg before timeout) = 1 minute
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 37.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 38.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 43.minutes)

      # Window 4: 44min (first msg) -> 48min (last msg before timeout) = 4 minutes
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 44.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 46.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 48.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 53.minutes)

      # Conversation 2
      # Window 1: 0min (first msg) -> 5min (last msg before timeout) = 5 minutes
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 3.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 5.minutes)
      create(:message, conversation: conversation2, direction: "outgoing", state: :closed_window, created_at: base_time + 10.minutes)

      # Window 2: 19min (first msg) -> 26min (last msg before timeout) = 7 minutes
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 19.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 21.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 23.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 26.minutes)
      create(:message, conversation: conversation2, direction: "outgoing", state: :closed_window, created_at: base_time + 31.minutes)

      # Expected window durations (first message to last message before timeout):
      # Conversation 1: 7, 4, 1, 4 minutes (average: 4 minutes = 240 seconds)
      # Conversation 2: 5, 7 minutes (average: 6 minutes = 360 seconds)
      # Hub average: (7 + 4 + 1 + 4 + 5 + 7) / 6 = 4.67 minutes = 280 seconds
      result = service.average_timeout_window_interval

      expect(result).to be_within(1).of(280.0)
    end

    it "excludes windows in soft-deleted conversations" do
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 3.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 8.minutes)
      conversation1.update!(deleted_at: Time.current)

      expect(service.average_timeout_window_interval).to eq(0)
    end

    it "returns 0 when there are no closed_window messages" do
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "outgoing", state: :bot_message, created_at: from + 1.day + 5.minutes)

      result = service.average_timeout_window_interval

      expect(result).to eq(0)
    end

    it "excludes conversations from other hubs" do
      other_hub = create(:hub)
      other_conversation = create(:conversation, platform: "whatsapp", hub: other_hub, created_at: from + 1.day)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 3.minutes)
      create(:message, conversation: other_conversation, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 8.minutes)

      # Create a window in our hub: first msg at 0, last msg at 2min, timeout at 7min = 2 min duration
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_interval

      # Should only count the 2 minute (120 seconds) window from our hub
      expect(result).to eq(120.0)
    end

    it "excludes internal platform conversations" do
      internal_conversation = create(:conversation, platform: "internal", hub: hub, created_at: from + 1.day)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day + 3.minutes)
      create(:message, conversation: internal_conversation, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 8.minutes)

      # Create a window in a non-internal conversation: first msg at 0, last msg at 2min, timeout at 7min = 2 min duration
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_interval

      # Should only count the 2 minute (120 seconds) window from non-internal platform
      expect(result).to eq(120.0)
    end

    it "respects the time range filter" do
      # Create window outside the range (before)
      early_conversation = create(:conversation, platform: "whatsapp", hub: hub, created_at: from - 10.days)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days + 3.minutes)
      create(:message, conversation: early_conversation, direction: "outgoing", state: :closed_window, created_at: from - 10.days + 8.minutes)

      # Create window inside the range: first msg at 0, last msg at 2min, timeout at 7min = 2 min duration
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_interval

      # Should only count the 2 minute (120 seconds) window within the range
      expect(result).to eq(120.0)
    end

    it "calculates window duration for a realistic conversation with question-answer pairs" do
      base_time = from + 1.day

      # Window 1: 17:15 -> 17:20 (5 minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 1", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 1", state: :bot_message, created_at: base_time + 1.minute)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 2", created_at: base_time + 4.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 2", state: :bot_message, created_at: base_time + 5.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "timeout", state: :closed_window, created_at: base_time + 10.minutes)

      # Window 2: 18:00 -> 18:10 (10 minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 3", created_at: base_time + 45.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 3", state: :bot_message, created_at: base_time + 46.minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 4", created_at: base_time + 49.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 4", state: :bot_message, created_at: base_time + 50.minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 5", created_at: base_time + 54.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 5", state: :bot_message, created_at: base_time + 55.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "timeout", state: :closed_window, created_at: base_time + 60.minutes)

      # Expected: Window 1 (5 min) + Window 2 (10 min) / 2 = 7.5 minutes = 450 seconds
      result = service.average_timeout_window_interval

      expect(result).to eq(450.0)
    end
  end

  describe "#average_timeout_window_message_count" do
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub, created_at: from + 1.day) }
    let!(:conversation2) { create(:conversation, platform: "telegram", hub: hub, created_at: from + 2.days) }

    it "calculates the average number of incoming messages per window across multiple conversations" do
      base_time = from + 1.day

      # Conversation 1
      # Window 1: 3 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 1.minute)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 4.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 5.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 7.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 12.minutes)

      # Window 2: 2 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 21.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 22.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 25.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 30.minutes)

      # Window 3: 4 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 37.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 38.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 39.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 40.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 43.minutes)

      # Conversation 2
      # Window 1: 5 incoming messages
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 1.minute)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 2.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 3.minutes)
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 5.minutes)
      create(:message, conversation: conversation2, direction: "outgoing", state: :closed_window, created_at: base_time + 10.minutes)

      # Window 2: 1 incoming message
      create(:message, conversation: conversation2, direction: "incoming", created_at: base_time + 19.minutes)
      create(:message, conversation: conversation2, direction: "outgoing", created_at: base_time + 20.minutes)
      create(:message, conversation: conversation2, direction: "outgoing", state: :closed_window, created_at: base_time + 31.minutes)

      # Expected message counts per window:
      # Conversation 1: 3, 2, 4 incoming messages
      # Conversation 2: 5, 1 incoming messages
      # Hub average: (3 + 2 + 4 + 5 + 1) / 5 = 3.0
      result = service.average_timeout_window_message_count

      expect(result).to eq(3.0)
    end

    it "only counts incoming messages, not outgoing messages" do
      base_time = from + 1.day

      # Window with 2 incoming and 3 outgoing (should count only 2)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 1.minute)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 3.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 4.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 10.minutes)

      result = service.average_timeout_window_message_count

      expect(result).to eq(2.0)
    end

    it "returns 0 when there are no closed_window messages" do
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "outgoing", state: :bot_message, created_at: from + 1.day + 5.minutes)

      result = service.average_timeout_window_message_count

      expect(result).to eq(0)
    end

    it "returns 0 when windows have no incoming messages" do
      base_time = from + 1.day

      # Window with only outgoing messages
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", created_at: base_time + 1.minute)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 10.minutes)

      result = service.average_timeout_window_message_count

      expect(result).to eq(0)
    end

    it "excludes conversations from other hubs" do
      other_hub = create(:hub)
      other_conversation = create(:conversation, platform: "whatsapp", hub: other_hub, created_at: from + 1.day)

      # Other hub window: 5 incoming messages (should not be counted)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 1.minute)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 3.minutes)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 4.minutes)
      create(:message, conversation: other_conversation, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 8.minutes)

      # Our hub window: 2 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_message_count

      # Should only count the 2 messages from our hub
      expect(result).to eq(2.0)
    end

    it "excludes internal platform conversations" do
      internal_conversation = create(:conversation, platform: "internal", hub: hub, created_at: from + 1.day)

      # Internal window: 4 incoming messages (should not be counted)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day + 1.minute)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day + 3.minutes)
      create(:message, conversation: internal_conversation, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 8.minutes)

      # Non-internal window: 3 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 1.minute)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_message_count

      # Should only count the 3 messages from non-internal platform
      expect(result).to eq(3.0)
    end

    it "respects the time range filter" do
      # Create window outside the range (before) with 5 messages
      early_conversation = create(:conversation, platform: "whatsapp", hub: hub, created_at: from - 10.days)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days + 1.minute)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days + 2.minutes)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days + 3.minutes)
      create(:message, conversation: early_conversation, direction: "incoming", created_at: from - 10.days + 4.minutes)
      create(:message, conversation: early_conversation, direction: "outgoing", state: :closed_window, created_at: from - 10.days + 8.minutes)

      # Create window inside the range with 2 messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: from + 1.day + 7.minutes)

      result = service.average_timeout_window_message_count

      # Should only count the 2 messages within the range
      expect(result).to eq(2.0)
    end

    it "calculates message count for a realistic conversation with question-answer pairs" do
      base_time = from + 1.day

      # Window 1: 2 incoming messages (question 1, question 2)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 1", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 1", state: :bot_message, created_at: base_time + 1.minute)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 2", created_at: base_time + 4.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 2", state: :bot_message, created_at: base_time + 5.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "timeout", state: :closed_window, created_at: base_time + 10.minutes)

      # Window 2: 3 incoming messages (question 3, question 4, question 5)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 3", created_at: base_time + 45.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 3", state: :bot_message, created_at: base_time + 46.minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 4", created_at: base_time + 49.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 4", state: :bot_message, created_at: base_time + 50.minutes)
      create(:message, conversation: conversation1, direction: "incoming", body: "question 5", created_at: base_time + 54.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "answer 5", state: :bot_message, created_at: base_time + 55.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", body: "timeout", state: :closed_window, created_at: base_time + 60.minutes)

      # Expected: Window 1 (2 messages) + Window 2 (3 messages) / 2 = 2.5
      result = service.average_timeout_window_message_count

      expect(result).to eq(2.5)
    end

    it "correctly handles multiple windows in the same conversation separated by timeouts" do
      base_time = from + 1.day

      # Window 1: 1 incoming message
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 5.minutes)

      # Window 2: 2 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 10.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 11.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 15.minutes)

      # Window 3: 3 incoming messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 20.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 21.minutes)
      create(:message, conversation: conversation1, direction: "incoming", created_at: base_time + 22.minutes)
      create(:message, conversation: conversation1, direction: "outgoing", state: :closed_window, created_at: base_time + 25.minutes)

      # Expected: (1 + 2 + 3) / 3 = 2.0
      result = service.average_timeout_window_message_count

      expect(result).to eq(2.0)
    end
  end

  describe "#unique_end_users" do
    let!(:external_user1) { create(:external_user) }
    let!(:external_user2) { create(:external_user) }
    let!(:external_user3) { create(:external_user) }
    let!(:conversation1) { create(:conversation, platform: "whatsapp", hub: hub, participant: external_user1, created_at: from + 1.day) }
    let!(:conversation2) { create(:conversation, platform: "telegram", hub: hub, participant: external_user2, created_at: from + 2.days) }
    let!(:conversation3) { create(:conversation, platform: "whatsapp", hub: hub, participant: external_user3, created_at: from + 3.days) }

    it "counts unique external users who sent messages within the time range" do
      # User 1 sends 2 messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 1.hour)

      # User 2 sends 1 message
      create(:message, conversation: conversation2, direction: "incoming", created_at: from + 2.days)

      # User 3 sends 3 messages
      create(:message, conversation: conversation3, direction: "incoming", created_at: from + 3.days)
      create(:message, conversation: conversation3, direction: "incoming", created_at: from + 3.days + 1.hour)
      create(:message, conversation: conversation3, direction: "incoming", created_at: from + 3.days + 2.hours)

      result = service.unique_end_users

      # Should count 3 unique users
      expect(result).to eq(3)
    end

    it "excludes users whose only conversation is soft-deleted" do
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation2, direction: "incoming", created_at: from + 2.days)
      conversation1.update!(deleted_at: Time.current)

      expect(service.unique_end_users).to eq(1)
    end

    it "does not double count the same user sending multiple messages" do
      # User 1 sends multiple messages
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 1.hour)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 2.hours)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day + 3.hours)

      result = service.unique_end_users

      # Should count only 1 unique user
      expect(result).to eq(1)
    end

    it "only counts users who sent incoming messages, not just received outgoing messages" do
      # User 1 sends incoming message
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)

      # User 2 only receives outgoing messages (no incoming)
      create(:message, conversation: conversation2, direction: "outgoing", created_at: from + 2.days)
      create(:message, conversation: conversation2, direction: "outgoing", created_at: from + 2.days + 1.hour)

      result = service.unique_end_users

      # Should count only user 1
      expect(result).to eq(1)
    end

    it "excludes users from other hubs" do
      other_hub = create(:hub)
      other_user = create(:external_user)
      other_conversation = create(:conversation, platform: "whatsapp", hub: other_hub, participant: other_user)

      # User from other hub sends messages
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: other_conversation, direction: "incoming", created_at: from + 1.day + 1.hour)

      # User from our hub sends message
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)

      result = service.unique_end_users

      # Should count only user from our hub
      expect(result).to eq(1)
    end

    it "excludes internal platform conversations" do
      internal_user = create(:user)
      internal_conversation = create(:conversation, platform: "internal", hub: hub, participant: internal_user)

      # Internal user (application user) sends messages
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day)
      create(:message, conversation: internal_conversation, direction: "incoming", created_at: from + 1.day + 1.hour)

      # External user in non-internal conversation sends message
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)

      result = service.unique_end_users

      # Should count only external user from non-internal platform
      expect(result).to eq(1)
    end

    it "excludes non-ExternalUser participants" do
      # Create a User participant (not ExternalUser)
      user = create(:user)
      user_conversation = create(:conversation, platform: "internal", hub: hub, participant: user)

      # User (admin/staff) sends messages
      create(:message, conversation: user_conversation, direction: "incoming", created_at: from + 1.day)

      # External user sends message
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)

      result = service.unique_end_users

      # Should count only external user, not User participant
      expect(result).to eq(1)
    end

    it "respects the time range filter" do
      # User sends message outside range (before)
      create(:message, conversation: conversation1, direction: "incoming", created_at: from - 1.day)

      # User sends message outside range (after)
      create(:message, conversation: conversation2, direction: "incoming", created_at: to + 1.day)

      # User sends message inside range
      create(:message, conversation: conversation3, direction: "incoming", created_at: from + 1.day)

      result = service.unique_end_users

      # Should count only user who sent message within range
      expect(result).to eq(1)
    end

    it "returns 0 when no incoming messages exist" do
      # Create only outgoing messages
      create(:message, conversation: conversation1, direction: "outgoing", created_at: from + 1.day)
      create(:message, conversation: conversation2, direction: "outgoing", created_at: from + 2.days)

      result = service.unique_end_users

      expect(result).to eq(0)
    end

    it "returns 0 when no messages exist at all" do
      result = service.unique_end_users

      expect(result).to eq(0)
    end

    it "counts users across multiple conversations with the same user" do
      # Create multiple conversations for the same user
      conversation1b = create(:conversation, platform: "telegram", hub: hub, participant: external_user1, created_at: from + 1.day)

      # User 1 sends message in first conversation
      create(:message, conversation: conversation1, direction: "incoming", created_at: from + 1.day)

      # Same user sends message in second conversation
      create(:message, conversation: conversation1b, direction: "incoming", created_at: from + 2.days)

      # User 2 sends message
      create(:message, conversation: conversation2, direction: "incoming", created_at: from + 3.days)

      result = service.unique_end_users

      # Should count 2 unique users (user1 and user2), even though user1 has 2 conversations
      expect(result).to eq(2)
    end
  end
end
