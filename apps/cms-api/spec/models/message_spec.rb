require "rails_helper"

RSpec.describe Message, type: :model do
  def other_embedding
    Array.new(1024, 0.2)
  end

  it "is valid with valid attributes" do
    message = build(:message, :outgoing)
    expect(message).to be_valid
  end

  it "is invalid without a body" do
    message = build(:message, :outgoing, body: nil)
    expect(message).not_to be_valid
  end

  it "is invalid without a direction" do
    message = build(:message, :outgoing, direction: nil)
    expect(message).not_to be_valid
  end

  it "is invalid with invalid direction" do
    expect {
      build(:message, direction: "upwards")
    }.to raise_error(ArgumentError)
  end

  it "belongs to a conversation" do
    conversation = create(:conversation)
    message = create(:message, :outgoing, conversation: conversation)
    expect(message.conversation).to eq(conversation)
  end

  it "enqueues KnowledgeServiceWorker for incoming message" do
    conversation = create(:conversation)
    create(:message, :incoming, conversation: conversation)

    expect(KnowledgeServiceWorker).to receive(:perform_async).with("chat", anything)
    create(:message, :incoming, conversation: conversation)
  end

  it "does not enqueue worker for outgoing message" do
    expect(KnowledgeServiceWorker).not_to receive(:perform_async).with("chat", anything)
    create(:message, :outgoing)
  end

  it "saves metadata with invalid character" do
    conversation = create(:conversation)
    expect {
      create(:message, :incoming, conversation: conversation, metadata: {chunks: ["Foo\u0000bar"]})
    }.to change { conversation.messages.incoming.count }.by(1)
  end

  describe "first message in conversation" do
    let(:conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal") }

    before do
      ConversationRateLimiter.new(conversation).reset!
    end

    it "leaves the welcome to a worker instead of acknowledging the first incoming message" do
      allow(ChatTimeoutWorker).to receive(:perform_in)
      allow(WelcomeMessageWorker).to receive(:perform_async)

      message = create(:message, :incoming, conversation: conversation, body: "Hello")

      expect(WelcomeMessageWorker).to have_received(:perform_async).with(message.id)
      expect(conversation.messages.outgoing).to be_empty
    end

    it "shows a typing indicator, without the SMS acknowledgement fallback, until the welcome arrives" do
      telegram_conversation = create(:conversation, platform: "telegram", participant: create(:external_user, platform: "telegram", external_id: "uid"))
      ConversationRateLimiter.new(telegram_conversation).reset!
      allow(ChatTimeoutWorker).to receive(:perform_in)
      allow(WelcomeMessageWorker).to receive(:perform_async)
      allow(TypingIndicatorWorker).to receive(:perform_async)

      message = create(:message, :incoming, conversation: telegram_conversation, body: "Hello")

      expect(TypingIndicatorWorker).to have_received(:perform_async).with(message.id)
    end

    it "does not create acknowledgement messages for subsequent incoming messages (the frontend shows a typing animation)" do
      allow(KnowledgeService).to receive(:preview).with("first_message", anything).and_return("Welcome.")
      allow(ChatTimeoutWorker).to receive(:perform_in)

      create(:message, :incoming, conversation: conversation, body: "Hello")
      create(:message, :incoming, conversation: conversation, body: "Follow up question")

      expect(conversation.messages.where(state: :bot_processing).count).to eq(0)
    end

    it "leaves starting the chat to the welcome worker" do
      allow(ChatTimeoutWorker).to receive(:perform_in)

      expect(KnowledgeServiceWorker).not_to receive(:perform_async).with("chat", anything)
      create(:message, :incoming, conversation: conversation, body: "Hello")
    end
  end

  describe "typing indicator acknowledgement" do
    ["whatsapp", "telegram"].each do |platform|
      it "sends a typing indicator instead of an acknowledgement message for subsequent incoming #{platform} messages" do
        conversation = create(:conversation, platform: platform, participant: create(:external_user, platform: platform, external_id: "uid"))
        ConversationRateLimiter.new(conversation).reset!
        allow(KnowledgeService).to receive(:preview).with("first_message", anything).and_return("Welcome.")
        allow(ChatTimeoutWorker).to receive(:perform_in)
        allow(TypingIndicatorWorker).to receive(:perform_async)
        create(:message, :incoming, conversation: conversation, body: "Hello")

        message = nil
        expect {
          message = create(:message, :incoming, conversation: conversation, body: "Follow up question")
        }.not_to change { conversation.messages.where(state: :bot_processing).count }

        expect(TypingIndicatorWorker).to have_received(:perform_async).with(message.id, true)
      end
    end

    it "creates an acknowledgement message for subsequent incoming messages on platforms without typing support (SMS)" do
      conversation = create(:conversation, platform: "sms", participant: create(:external_user, platform: "sms", external_id: "uid"))
      ConversationRateLimiter.new(conversation).reset!
      allow(KnowledgeService).to receive(:preview).with("first_message", anything).and_return("Welcome.")
      allow(ChatTimeoutWorker).to receive(:perform_in)
      allow(TypingIndicatorWorker).to receive(:perform_async)
      create(:message, :incoming, conversation: conversation, body: "Hello")

      expect {
        create(:message, :incoming, conversation: conversation, body: "Follow up question")
      }.to change { conversation.messages.where(state: :bot_processing).count }.by(1)

      expect(TypingIndicatorWorker).not_to have_received(:perform_async)
    end
  end

  describe "rate limiting" do
    let(:conversation) { create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal") }

    around do |example|
      original_env = ENV.to_h
      example.run
      ENV.replace(original_env)
    end

    before do
      ENV["MESSAGE_RATE_LIMIT"] = "1"
      # Clear any existing rate limit
      ConversationRateLimiter.new(conversation).reset!
    end

    context "when conversation is not locked" do
      it "enqueues KnowledgeServiceWorker without creating an acknowledgement message" do
        # Create a prior message so the next one is not the first (which would get a welcome message instead)
        allow(KnowledgeServiceWorker).to receive(:perform_async)
        allow(ChatTimeoutWorker).to receive(:perform_in)
        create(:message, :incoming, conversation: conversation, body: "First message")
        ConversationRateLimiter.new(conversation).reset!

        expect(KnowledgeServiceWorker).to receive(:perform_async).with("chat", anything)

        expect {
          create(:message, :incoming, conversation: conversation, body: "Hello")
        }.not_to change { conversation.messages.where(state: :bot_processing).count }
      end

      it "acquires the rate limit lock" do
        limiter = ConversationRateLimiter.new(conversation)
        expect(limiter.locked?).to be false

        create(:message, :incoming, conversation: conversation, body: "Hello")

        expect(limiter.locked?).to be true
      end
    end

    context "when conversation is locked (rate limit reached)" do
      before do
        # Simulate a pending message by acquiring the lock
        limiter = ConversationRateLimiter.new(conversation)
        limiter.acquire!
      end

      it "creates rate limit message instead of loading message" do
        expect {
          create(:message, :incoming, conversation: conversation, body: "Another question")
        }.to change { conversation.messages.where(body: I18n.t(:message_conversation_locked)).count }.by(1)
      end

      it "does not enqueue KnowledgeServiceWorker" do
        expect(KnowledgeServiceWorker).not_to receive(:perform_async).with("chat", anything)
        create(:message, :incoming, conversation: conversation, body: "Another question")
      end

      it "does not create loading message" do
        expect {
          create(:message, :incoming, conversation: conversation, body: "Another question")
        }.not_to change { conversation.messages.where(body: "...").count }
      end

      it "creates rate limit message in the conversation language" do
        conversation.update_column(:language, "ar")
        create(:message, :incoming, conversation: conversation, body: "Another question")
        rate_limit_message = conversation.messages.where(state: :rate_limit_reached).last
        expect(rate_limit_message.body).to eq(I18n.t(:message_conversation_locked, locale: :ar))
      end
    end
  end

  it "updates conversation when message is updated" do
    conversation = create(:conversation)
    updated_at = conversation.updated_at
    create(:message, :outgoing, conversation: conversation)
    expect(conversation.reload.updated_at).to be > updated_at
  end

  it "can be a notebook item" do
    hub = build(:hub)
    conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), hub: hub)
    message = create(:message, :outgoing, conversation: conversation)
    notebook = create(:notebook, hub: hub)
    notebook.messages << message
    expect(message.reload.notebooks.to_a).to eq([notebook])
  end

  it "updates external user" do
    user = create(:external_user, messages_count: 0, first_message_at: nil, last_message_at: nil)
    conversation = create(:conversation, participant: user, platform: "telegram")
    message = create(:message, :incoming, conversation: conversation)
    expect(user.reload.first_message_at).to eq(message.created_at)
    expect(user.reload.last_message_at).to eq(message.created_at)
    expect(user.reload.messages_count).to eq(1)
    other_message = create(:message, :incoming, conversation: conversation)
    expect(user.reload.first_message_at).to eq(message.created_at)
    expect(user.reload.last_message_at).to eq(other_message.created_at)
    expect(user.reload.messages_count).to eq(2)
  end

  it "enqueues MessageSenderWorker for non-internal outgoing message" do
    conversation = create(:conversation, participant: create(:external_user, platform: "telegram"), platform: "telegram")
    expect(MessageSenderWorker).to receive(:perform_async).with(anything)
    create(:message, :outgoing, conversation: conversation)
  end

  it "does not enqueue worker for outgoing internal message" do
    conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
    expect(MessageSenderWorker).not_to receive(:perform_async).with(anything)
    create(:message, :outgoing, conversation: conversation)
  end

  describe "#history_for_knowledge_service" do
    it "generates the history for the Knowledge Service" do
      allow(ENV).to receive(:fetch).and_call_original
      allow(ENV).to receive(:fetch).with("MESSAGE_RATE_LIMIT", "3").and_return("1")
      conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
      message = nil
      ["Hi", "Please send a suitable question", "How are you?", "I'm fine", "What's your favorite color?", "Red", "What's your name?", "My name is Bot", "How old are you?"].each_with_index do |body, index|
        direction = (index % 2 == 0) ? "incoming" : "outgoing"
        message = create(:message, direction: direction, conversation: conversation, body: body)
      end
      expect(conversation.messages.count).to eq(13) # Make sure the intermediaries are created
      expect(message.history_for_knowledge_service.size).to eq(4)
    end

    it "uses only the replied-to message as context when present" do
      conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
      old_message = create(:message, :outgoing, conversation: conversation, body: "Old bot answer")
      create(:message, :incoming, conversation: conversation, body: "Recent question")
      create(:message, :outgoing, conversation: conversation, body: "Recent answer")

      reply = create(:message, :incoming, conversation: conversation, body: "About that old answer", metadata: {replied_to_message_id: old_message.id})

      history = reply.history_for_knowledge_service
      expect(history).to eq([{role: "assistant", content: "Old bot answer"}])
    end

    it "falls back to recent history when no replied-to message in metadata" do
      conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
      create(:message, :outgoing, conversation: conversation, body: "Bot says hi")
      message = create(:message, :incoming, conversation: conversation, body: "User says hello")

      history = message.history_for_knowledge_service
      expect(history.size).to eq(1)
      expect(history.first).to eq({role: "assistant", content: "Bot says hi"})
    end

    it "marks a bot reply that refused a question for lack of a location" do
      conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
      create(:message, :incoming, conversation: conversation, body: "Where can I vote?")
      create(:message, :outgoing, conversation: conversation, body: "I need your location first.", metadata: {user_location_missing: true})
      reply = create(:message, :incoming, conversation: conversation, body: "Zagreb")

      history = reply.history_for_knowledge_service
      expect(history.size).to eq(2)
      expect(history.first).to eq({role: "user", content: "Where can I vote?"})
      expect(history.last).to eq({role: "assistant", content: "I need your location first.", user_location_missing: true})
    end

    it "excludes non_question_reply messages from history" do
      conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
      create(:message, :outgoing, conversation: conversation, body: "Hello there!", state: :non_question_reply)
      message = create(:message, :incoming, conversation: conversation, body: "What's up")

      history = message.history_for_knowledge_service
      expect(history).to eq([])
    end

    context "when exclude_before_closed_window: true" do
      it "excludes messages before a closed_window message" do
        conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
        create(:message, :outgoing, conversation: conversation, body: "Old answer")
        create(:message, :outgoing, conversation: conversation, state: :closed_window)
        create(:message, :outgoing, conversation: conversation, body: "New answer")
        message = create(:message, :incoming, conversation: conversation, body: "New question")

        history = message.history_for_knowledge_service(exclude_before_closed_window: true)
        expect(history).to eq([{role: "assistant", content: "New answer"}])
      end

      it "excludes messages received before the conversation went inactive, even when no closed_window message exists" do
        conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
        create(:message, :incoming, conversation: conversation, body: "Old question", created_at: Conversation.inactivity_timeout.ago - 1.day)
        create(:message, :outgoing, conversation: conversation, body: "Old answer", created_at: Conversation.inactivity_timeout.ago - 1.day + 1.minute)
        message = create(:message, :incoming, conversation: conversation, body: "New question")

        history = message.history_for_knowledge_service(exclude_before_closed_window: true)
        expect(history).to eq([])
      end

      it "includes messages when the conversation has stayed active, even when no closed_window message exists" do
        conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
        create(:message, :incoming, conversation: conversation, body: "Old question")
        create(:message, :outgoing, conversation: conversation, body: "Old answer")
        message = create(:message, :incoming, conversation: conversation, body: "New question")

        history = message.history_for_knowledge_service(exclude_before_closed_window: true)
        expect(history.map { |h| h[:content] }).to include("Old question", "Old answer")
      end

      it "separates a gap-closed prior session from the current active one" do
        conversation = create(:conversation, participant: create(:user, email: Faker::Internet.email), platform: "internal")
        create(:message, :outgoing, conversation: conversation, body: "Old answer", created_at: Conversation.inactivity_timeout.ago - 1.day)
        create(:message, :incoming, conversation: conversation, body: "Recent question")
        create(:message, :outgoing, conversation: conversation, body: "Recent answer")
        message = create(:message, :incoming, conversation: conversation, body: "New question")

        history = message.history_for_knowledge_service(exclude_before_closed_window: true)
        expect(history.map { |h| h[:content] }).to include("Recent question", "Recent answer")
        expect(history.map { |h| h[:content] }).not_to include("Old answer")
      end
    end
  end

  it "defines the state" do
    message = create(:message, :incoming)
    expect(message.state).to eq("user_message")
    message = create(:message, :outgoing, body: "...")
    expect(message.state).to eq("bot_processing")
    message = create(:message, :outgoing)
    expect(message.state).to eq("bot_message")
  end

  describe "#text_for_summarization" do
    it "returns the message body" do
      message = create(:message, :outgoing, body: "Hello world")
      expect(message.text_for_summarization).to eq("Hello world")
    end
  end

  describe "#as_json" do
    it "includes the message's topic names" do
      hub = create(:hub)
      conversation = create(:conversation, hub: hub)
      message = create(:message, :incoming, conversation: conversation)
      message.topics << hub.topics.create!(name: "Climate")

      expect(message.as_json[:topic_names]).to eq(["Climate"])
    end
  end

  describe "#data_source_items" do
    let(:hub) { create(:hub) }
    let(:conversation) { create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email)) }

    it "creates relationships only for outgoing messages" do
      document = create(:document, source: create(:source, hub: hub))
      data_source_item_id = Base64.encode64("Document/#{document.id}")

      incoming_message = create(:message, :incoming, conversation: conversation, metadata: {document_ids_cited: [data_source_item_id]})
      outgoing_message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [data_source_item_id]})

      expect(incoming_message.message_data_source_items.count).to eq(0)
      expect(outgoing_message.message_data_source_items.count).to eq(1)
    end

    it "does not create duplicate relationships for the same data source item" do
      document = create(:document, source: create(:source, hub: hub))
      data_source_item_id = Base64.encode64("Document/#{document.id}")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [data_source_item_id, data_source_item_id]})

      expect(message.message_data_source_items.count).to eq(1)
    end

    it "creates MessageDataSourceItem for only existing items" do
      document = create(:document, source: create(:source, hub: hub))

      valid_id = Base64.encode64("Document/#{document.id}")
      orphan_id = Base64.encode64("Document/99999")

      expect { create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [valid_id, orphan_id]}) }
        .to change(MessageDataSourceItem, :count).by(1)
    end

    it "returns empty array when data_source_item_ids_used is not present" do
      message = create(:message, :outgoing, conversation: conversation, metadata: {})
      expect(message.data_source_items).to eq([])
    end

    it "returns existing data_source_items complete data" do
      document = create(:document, source: create(:source, hub: hub))
      contribution = create(:contribution, hub: hub)
      notebook = create(:notebook, hub: hub)

      document_id = Base64.encode64("Document/#{document.id}")
      contribution_id = Base64.encode64("Contribution/#{contribution.id}")
      notebook_id = Base64.encode64("Notebook/#{notebook.id}")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [document_id, contribution_id, notebook_id]})

      data_source_items = message.data_source_items
      expect(data_source_items.length).to eq(3)

      expect(data_source_items).to include({
        type: "Document",
        id: document.id,
        title: document.title,
        external_url: document.external_url,
        updated_at: document.updated_at,
        active: document.active,
        priority_tier: document.priority_tier,
        deleted: document.nil?,
        document_type: document.document_type,
        document_size: document.document_size,
        content: document.content
      })

      expect(data_source_items).to include({
        type: "Contribution",
        id: contribution.id,
        title: contribution.title,
        updated_at: contribution.updated_at,
        content: contribution.content,
        active: contribution.active,
        priority_tier: contribution.priority_tier,
        deleted: contribution.nil?,
        message: {
          conversation: {
            platform: conversation.platform,
            participant: {
              name: conversation.participant.name,
              type: conversation.participant_type,
              trusted_user: false
            }
          }
        }
      })

      expect(data_source_items).to include({
        type: "Notebook",
        id: notebook.id,
        title: notebook.title,
        updated_at: notebook.updated_at,
        active: notebook.active,
        priority_tier: notebook.priority_tier,
        deleted: notebook.nil?,
        summary: notebook.summary,
        published_at: notebook.published_at,
        name: notebook.name,
        user: {
          name: notebook.user.name,
          email: notebook.user.email,
          profile_picture_url: notebook.user.profile_picture_url
        }
      })
    end

    it "returns deleted data_source_items minimum data" do
      document = create(:document, source: create(:source, hub: hub))
      document_id = Base64.encode64("Document/#{document.id}")
      type = document.class.name
      id = document.id
      title = document.title

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [document_id]})

      document.destroy
      message.reload

      expect(message.data_source_items).to include({
        type: type,
        id: id,
        title: title,
        deleted: true
      })
    end

    it "excludes data_source_items from different hub" do
      other_hub = create(:hub)
      document = create(:document, source: create(:source, hub: other_hub))
      data_source_item_id = Base64.encode64("Document/#{document.id}")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [data_source_item_id]})

      expect(message.data_source_items).to eq([])
    end

    it "does not include non-existent data_source_items" do
      document_data_source_item_id = Base64.encode64("Document/99999")
      contribution_data_source_item_id = Base64.encode64("Contribution/99999")
      notebook_data_source_item_id = Base64.encode64("Notebook/99999")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [document_data_source_item_id, contribution_data_source_item_id, notebook_data_source_item_id]})

      expect(message.data_source_items).to eq([])
    end

    it "excludes invalid class types" do
      invalid_id = Base64.encode64("InvalidClass/123")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [invalid_id]})

      expect(message.data_source_items).to eq([])
    end

    it "filters out invalid data_source_items but keeps valid ones" do
      document = create(:document, source: create(:source, hub: hub))
      other_hub = create(:hub)
      other_document = create(:document, source: create(:source, hub: other_hub))

      valid_id = Base64.encode64("Document/#{document.id}")
      invalid_hub_id = Base64.encode64("Document/#{other_document.id}")
      invalid_class_id = Base64.encode64("InvalidClass/123")

      message = create(:message, :outgoing, conversation: conversation, metadata: {document_ids_cited: [valid_id, invalid_hub_id, invalid_class_id]})
      data_source_items = message.data_source_items

      expect(data_source_items.length).to eq(1)
      expect(data_source_items.first).to include(
        type: "Document",
        id: document.id,
        title: document.title,
        document_type: document.document_type,
        external_url: document.external_url,
        updated_at: document.updated_at,
        active: document.active
      )
    end
  end

  describe "#top_topics" do
    let(:hub) { create(:hub) }
    let(:conversation) { create(:conversation, hub: hub) }

    def find_or_create_topic(name)
      hub.topics.find_by(name: name) || hub.topics.create!(name: name)
    end

    # Adds an incoming message tagged with the given topics (the conversation's own topics).
    def message_with_topics(topic_names)
      message = create(:message, :incoming, conversation: conversation)
      topic_names.each { |name| message.topics << find_or_create_topic(name) }
      message
    end

    # Gives a topic a supporting document so it qualifies to be offered for subscription.
    def back_topic_with_document(topic_name, source_type: :rss_feed)
      document = create(:document, source: create(:source, hub: hub, source_type: source_type))
      document.topics << find_or_create_topic(topic_name)
      document
    end

    it "returns [] for a message that is not a closed_window" do
      message = create(:message, :outgoing, conversation: conversation)
      expect(message.top_topics).to eq([])
    end

    it "returns the window's topics ordered by frequency, most frequent first" do
      message_with_topics(["Climate", "Health"])
      message_with_topics(["Climate"])
      message_with_topics(["Elections"])
      ["Climate", "Health", "Elections"].each { |name| back_topic_with_document(name) }
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      # Climate appears in two messages; Elections and Health once each (tie broken by name)
      expect(closing.top_topics.map(&:name)).to eq(["Climate", "Elections", "Health"])
    end

    it "only includes topics that have at least one supporting document" do
      message_with_topics(["Foo", "Bar"])
      back_topic_with_document("Foo") # Bar has no document
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics.map(&:name)).to eq(["Foo"])
    end

    it "counts supporting documents from private sources too" do
      message_with_topics(["Foo"])
      back_topic_with_document("Foo", source_type: :uploaded_files)
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics.map(&:name)).to eq(["Foo"])
    end

    it "counts non-document data source items (e.g. a notebook) as supporting too" do
      message_with_topics(["Foo"])
      create(:notebook, hub: hub).topics << find_or_create_topic("Foo")
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics.map(&:name)).to eq(["Foo"])
    end

    it "returns [] when no conversation topic has a supporting document" do
      message_with_topics(["Foo", "Bar"])
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics).to eq([])
    end

    it "limits the number of topics returned" do
      message_with_topics(["Climate", "Elections", "Health", "Economy"])
      ["Climate", "Elections", "Health", "Economy"].each { |name| back_topic_with_document(name) }
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics(2).size).to eq(2)
    end

    it "only considers messages since the previous closed_window" do
      message_with_topics(["OldTopic"])
      back_topic_with_document("OldTopic")
      first_closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)
      message_with_topics(["NewTopic"])
      back_topic_with_document("NewTopic")
      second_closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(first_closing.top_topics.map(&:name)).to eq(["OldTopic"])
      expect(second_closing.top_topics.map(&:name)).to eq(["NewTopic"])
    end

    it "only counts topics since the most recent inactivity gap, even when no closed_window message exists" do
      old = create(:message, :incoming, conversation: conversation, created_at: Conversation.inactivity_timeout.ago - 1.day)
      old.topics << find_or_create_topic("OldTopic")
      back_topic_with_document("OldTopic")
      message_with_topics(["NewTopic"])
      back_topic_with_document("NewTopic")
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics.map(&:name)).to eq(["NewTopic"])
    end

    it "caps the window at MAX_WINDOW_MESSAGES even without a qualifying gap" do
      too_old = create(:message, :incoming, conversation: conversation)
      too_old.topics << find_or_create_topic("OldTopic")
      back_topic_with_document("OldTopic")

      Message::MAX_WINDOW_MESSAGES.times { create(:message, :outgoing, conversation: conversation) }

      message_with_topics(["NewTopic"])
      back_topic_with_document("NewTopic")
      closing = create(:message, :outgoing, conversation: conversation, state: :closed_window)

      expect(closing.top_topics.map(&:name)).to eq(["NewTopic"])
    end

    it "works on an unsaved closing message (open window before it is created)" do
      message_with_topics(["Climate"])
      back_topic_with_document("Climate")
      unsaved_closing = conversation.messages.new(direction: "outgoing", state: :closed_window)

      expect(unsaved_closing.top_topics.map(&:name)).to eq(["Climate"])
    end
  end

  describe "#has_public_source_documents?" do
    let(:hub) { create(:hub) }
    let(:conversation) { create(:conversation, hub: hub, platform: "whatsapp") }

    def message_citing(document)
      cited = Base64.encode64("Document/#{document.id}")
      create(:message, :outgoing, conversation: conversation, metadata: {answerable: true, document_ids_cited: [cited]})
    end

    it "returns true when a cited document comes from a public source" do
      document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      expect(message_citing(document).has_public_source_documents?).to be(true)
    end

    it "returns false when the cited document comes from a non-public source" do
      document = create(:document, source: create(:source, hub: hub, source_type: :google_drive_folder))
      expect(message_citing(document).has_public_source_documents?).to be(false)
    end

    it "returns false when the cited public-source document is inactive" do
      document = create(:document, source: create(:source, hub: hub, source_type: :website), active: false)
      expect(message_citing(document).has_public_source_documents?).to be(false)
    end

    it "returns false when no documents are cited" do
      message = create(:message, :outgoing, conversation: conversation, metadata: {answerable: true})
      expect(message.has_public_source_documents?).to be(false)
    end
  end

  describe "#interactive_buttons" do
    let(:hub) { create(:hub) }
    let(:conversation) { create(:conversation, hub: hub, platform: "whatsapp") }

    def closed_window_with_topic
      topic = hub.topics.create!(name: "Climate")
      create(:message, :incoming, conversation: conversation).topics << topic
      create(:document, source: create(:source, hub: hub)).topics << topic # supporting document
      create(:message, :outgoing, conversation: conversation, state: :closed_window)
    end

    it "returns a single Subscribe button for a closed_window message with topics" do
      conversation.update_column(:language, "pt")
      buttons = closed_window_with_topic.interactive_buttons

      expect(buttons.length).to eq(1)
      expect(buttons.first[:id]).to start_with("subscribe_")
      expect(buttons.first[:text]).to eq(I18n.t(:label_subscribe, locale: :pt))
      expect(buttons.first[:type]).to eq("subscribe")
    end

    it "returns nil for a closed_window message without topics" do
      message = create(:message, :outgoing, conversation: conversation, state: :closed_window)
      expect(message.interactive_buttons).to be_nil
    end

    it "returns a single Cancel button for a bot_contribution_started (prompt) message" do
      conversation.update_column(:language, "pt")
      message = create(:message, :outgoing, conversation: conversation, state: :bot_contribution_started)
      buttons = message.interactive_buttons

      expect(buttons.length).to eq(1)
      expect(buttons.first[:id]).to eq("cancel_contribution_#{message.id}")
      expect(buttons.first[:type]).to eq("cancel_contribution")
      expect(buttons.first[:text]).to eq(I18n.t(:contribution_cancel_word, locale: :pt))
    end

    it "returns See More and Unsubscribe buttons for a topic_notification message" do
      conversation.update_column(:language, "pt")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification, metadata: {"notification_topic_id" => 42})
      buttons = message.interactive_buttons

      expect(buttons.map { |button| button[:id] }).to eq(["see_sources_#{message.id}", "unsubscribe_42"])
      expect(buttons.map { |button| button[:type] }).to eq(["sources", "unsubscribe"])
      expect(buttons.map { |button| button[:text] }).to eq([I18n.t(:topic_notification_see_more_button, locale: :pt), I18n.t(:topic_notification_unsubscribe_button, locale: :pt)])
    end

    it "joins every covered topic in the Unsubscribe button id for a merged topic_notification" do
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification, metadata: {"notification_topic_ids" => [42, 43]})
      buttons = message.interactive_buttons

      expect(buttons.map { |button| button[:id] }).to eq(["see_sources_#{message.id}", "unsubscribe_42_43"])
    end

    def message_citing_public_document(metadata)
      document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      cited = Base64.encode64("Document/#{document.id}")
      create(:message, :outgoing, conversation: conversation, metadata: metadata.merge(document_ids_cited: [cited]))
    end

    it "returns nil for incoming message" do
      message = create(:message, :incoming, conversation: conversation)
      expect(message.interactive_buttons).to be_nil
    end

    it "returns nil when answerable is false" do
      message = message_citing_public_document(answerable: false)
      expect(message.interactive_buttons).to be_nil
    end

    it "returns nil when answerable is true but there are no public source documents" do
      document = create(:document, source: create(:source, hub: hub, source_type: :google_drive_folder))
      cited = Base64.encode64("Document/#{document.id}")
      message = create(:message, :outgoing, conversation: conversation, metadata: {answerable: true, document_ids_cited: [cited]})
      expect(message.interactive_buttons).to be_nil
    end

    it "returns nil when answerable is true but document_ids_cited is missing" do
      message = create(:message, :outgoing, conversation: conversation, metadata: {answerable: true})
      expect(message.interactive_buttons).to be_nil
    end

    it "returns button data when answerable is true and there are public source documents" do
      conversation.update_column(:language, "pt")
      message = message_citing_public_document(answerable: true)
      buttons = message.interactive_buttons

      expect(buttons).to be_an(Array)
      expect(buttons.length).to eq(1)
      expect(buttons.first[:id]).to eq("see_sources_#{message.id}")
      expect(buttons.first[:text]).to eq(I18n.t(:label_see_sources, locale: :pt))
      expect(buttons.first[:type]).to eq("sources")
    end
  end

  describe "#whatsapp_template" do
    let(:hub) { create(:hub) }
    let(:conversation) { create(:conversation, hub: hub, platform: "whatsapp") }

    it "returns nil for a regular message" do
      message = create(:message, :outgoing, conversation: conversation)
      expect(message.whatsapp_template).to be_nil
    end

    it "builds the template arguments for a topic_notification message" do
      document = create(:document, source: create(:source, hub: hub))
      topic = hub.topics.create!(name: "Climate")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification,
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)

      template = message.whatsapp_template

      expect(template[:name]).to eq(WhatsappMessagingIntegration.topic_notification_template_name("journalist"))
      expect(template[:language]).to eq(WhatsappMessagingIntegration.template_language_code(conversation.language))
      expect(template[:parameters]).to eq(["Climate", "\"#{document.title}\"."])
      expect(template[:button_payloads]).to eq(["see_sources_#{message.id}", "unsubscribe_#{topic.id}"])
    end

    it "joins the topic names for a notification that covers several topics" do
      document = create(:document, source: create(:source, hub: hub))
      climate = hub.topics.create!(name: "Climate")
      health = hub.topics.create!(name: "Health")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification,
        metadata: {"notification_topic_ids" => [health.id, climate.id]})
      message.message_data_source_items.create!(item: document)

      template = message.whatsapp_template

      expect(template[:parameters]).to eq(["Climate and Health", "\"#{document.title}\"."])
      expect(template[:button_payloads]).to eq(["see_sources_#{message.id}", "unsubscribe_#{health.id}_#{climate.id}"])
    end

    it "includes the document's URL in the content parameter when available" do
      document = create(:document, source: create(:source, hub: hub), metadata: {"url" => "https://example.com/article"})
      topic = hub.topics.create!(name: "Climate")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification,
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)

      template = message.whatsapp_template

      expect(template[:parameters]).to eq(["Climate", "\"#{document.title}\" (https://example.com/article)."])
    end

    it "drops the URL from the content parameter when it would overflow the template body limit" do
      long_url = "https://example.com/#{"a" * 1000}"
      document = create(:document, source: create(:source, hub: hub), metadata: {"url" => long_url})
      topic = hub.topics.create!(name: "Climate")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification,
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)

      template = message.whatsapp_template

      expect(template[:parameters]).to eq(["Climate", "\"#{document.title}\"."])
    end

    it "collapses whitespace in template parameters (WhatsApp rejects newlines/tabs)" do
      document = create(:document, title: "Line one\nLine two\tand    more", source: create(:source, hub: hub))
      topic = hub.topics.create!(name: "Climate\nChange")
      message = create(:message, :outgoing, conversation: conversation, state: :topic_notification,
        metadata: {"notification_topic_id" => topic.id})
      message.message_data_source_items.create!(item: document)

      template = message.whatsapp_template

      expect(template[:parameters]).to eq(["Climate Change", "\"Line one Line two and more\"."])
    end
  end

  describe ".notification_content_summary" do
    it "appends the first item's URL and counts the rest" do
      result = described_class.notification_content_summary(["First title", "Second title"], "https://example.com/first", "en")
      expect(result).to eq("\"First title\" (https://example.com/first) and 1 more.")
    end

    it "truncates a pathological title so the WhatsApp template body cannot overflow" do
      result = described_class.notification_content_summary(["word " * 60], nil, "en")
      expect(result.length).to be < 160
      expect(result).to include("…")
    end
  end

  describe "inactivity scheduling" do
    let(:conversation) { create(:conversation, platform: "whatsapp") }

    it "schedules an inactivity check for a regular outgoing message" do
      expect(ConversationInactivityWorker).to receive(:perform_in)
      create(:message, :outgoing, conversation: conversation)
    end

    expected_ignored_states = %w[
      closed_window
      topic_notification
      topic_notification_sources
      subscription_confirmed
      unsubscription_confirmed
      bot_contribution_started
      bot_contribution_submitted
      bot_contribution_cancelled
      non_question_reply
      bot_welcome_message
    ]

    it "ignores exactly the states expected to never generate a closed_window message" do
      expect(Message::IGNORED_STATES_FOR_TIMEOUT).to match_array(expected_ignored_states)
    end

    expected_ignored_states.each do |state|
      it "does not schedule an inactivity check for #{state} messages" do
        expect(ConversationInactivityWorker).not_to receive(:perform_in)
        create(:message, :outgoing, conversation: conversation, state: state)
      end
    end
  end

  describe "embedding" do
    it "stores and retrieves vector embeddings as arrays" do
      embedding = Array.new(1024, 0.5)
      message = create(:message, :incoming, embedding: embedding)

      message.reload
      expect(message.embedding).to be_an(Array)
      expect(message.embedding.size).to eq(1024)
      expect(message.embedding.first).to eq(0.5)
    end

    it "can be nil" do
      message = create(:message, :incoming, embedding: nil)
      expect(message.embedding).to be_nil
    end

    it "is invalid with the wrong number of dimensions" do
      message = build(:message, :incoming, embedding: Array.new(5, 0.5))

      expect(message).not_to be_valid
      expect(message.errors[:embedding]).to include("must have 1024 dimensions")
    end
  end

  describe "#embed?" do
    subject(:message) { build(:message, :incoming, body: "hello", embedding: nil, state: :user_message) }

    it { is_expected.to be_embed }

    it "returns false if outgoing" do
      expect(build(:message, :outgoing, body: "hello", embedding: nil)).not_to be_embed
    end

    it "returns false if embedding is already present" do
      expect(build(:message, :incoming, body: "hello", embedding: Array.new(1024, 0.1))).not_to be_embed
    end

    it "returns false if body is blank" do
      expect(build(:message, :incoming, body: nil, embedding: nil)).not_to be_embed
    end

    (Message.states.keys - ["user_message"]).each do |state|
      it "returns false for #{state} messages" do
        expect(build(:message, :incoming, body: "hello", embedding: nil, state: state)).not_to be_embed
      end
    end
  end

  describe "message_cluster association" do
    it "can belong to a message cluster" do
      cluster = create(:message_cluster)
      message = create(:message, :incoming, message_cluster: cluster)

      expect(message.message_cluster).to eq(cluster)
    end

    it "can exist without a cluster" do
      message = create(:message, :incoming, message_cluster: nil)
      expect(message.message_cluster).to be_nil
    end
  end

  describe ".in_live_conversations" do
    it "includes messages whose conversation is not soft-deleted and excludes the rest" do
      live = create(:message, :incoming)
      deleted = create(:message, :incoming)
      deleted.conversation.update!(deleted_at: Time.current)

      expect(Message.in_live_conversations).to include(live)
      expect(Message.in_live_conversations).not_to include(deleted)
    end
  end

  describe ".in_deleted_conversations" do
    it "includes messages whose conversation is soft-deleted and excludes the rest" do
      live = create(:message, :incoming)
      deleted = create(:message, :incoming)
      deleted.conversation.update!(deleted_at: Time.current)

      expect(Message.in_deleted_conversations).to include(deleted)
      expect(Message.in_deleted_conversations).not_to include(live)
    end
  end

  describe ".readable_by" do
    it "includes messages of conversations readable by the user and excludes the rest" do
      hub = create(:hub)
      viewer = create(:hub_membership, hub: hub).user
      member_message = create(:message, :incoming, conversation: create(:conversation, hub: hub, participant: create(:hub_membership, hub: hub).user))
      hidden_message = create(:message, :incoming, conversation: create(:conversation, hub: hub, participant: create(:user)))

      expect(Message.readable_by(viewer)).to include(member_message)
      expect(Message.readable_by(viewer)).not_to include(hidden_message)
    end

    it "includes messages of hidden conversations for super admins" do
      super_admin = create(:user, email: "admin@meedan.com")
      hidden_message = create(:message, :incoming, conversation: create(:conversation, participant: create(:user)))

      expect(Message.readable_by(super_admin)).to include(hidden_message)
    end
  end

  describe "#reassign_cluster_centroid" do
    let(:cluster) { create(:message_cluster) }

    it "promotes the next message in the cluster to centroid when the centroid is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      next_message = create(:message, :outgoing, message_cluster: cluster, embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id, centroid_embedding: centroid.embedding)

      centroid.destroy!

      cluster.reload
      expect(cluster.centroid_message_id).to eq(next_message.id)
      expect(cluster.centroid_embedding).to eq(next_message.embedding)
    end

    it "updates the cluster's original_text to the new centroid's body when the centroid is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster, body: "First question")
      create(:message, :outgoing, message_cluster: cluster, body: "Second question", embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id, original_text: centroid.body)

      centroid.destroy!

      expect(cluster.reload.original_text).to eq("Second question")
    end

    it "clears the cluster's ai_summary so notebooks regenerate it from the new original_text" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      create(:message, :outgoing, message_cluster: cluster, embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id, ai_summary: centroid.body)

      centroid.destroy!

      expect(cluster.reload.ai_summary).to be_nil
    end

    it "regenerates the cluster's summary in the notebooks holding it when the centroid is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      create(:message, :outgoing, message_cluster: cluster, embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id)
      notebook = create(:notebook, hub: cluster.hub)
      create(:notebook_item, notebook: notebook, item: cluster)
      allow(ItemSummaryWorker).to receive(:perform_async)

      centroid.destroy!

      expect(ItemSummaryWorker).to have_received(:perform_async).with("MessageCluster", cluster.id, notebook.id)
    end

    it "touches the cluster's updated_at when the centroid is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      create(:message, :outgoing, message_cluster: cluster, embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id, updated_at: 1.day.ago)

      centroid.destroy!

      expect(cluster.reload.updated_at).to be_within(1.minute).of(Time.current)
    end

    it "delete cluster when the last message in the cluster is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      cluster.update_columns(centroid_message_id: centroid.id, centroid_embedding: centroid.embedding)

      centroid.destroy!

      expect(MessageCluster.find_by_id(cluster.id)).to be_nil
    end

    it "deletes the cluster when its centroid is not a member and the cluster has no other messages" do
      centroid = create(:message, :outgoing, message_cluster: nil)
      cluster.update_columns(centroid_message_id: centroid.id, centroid_embedding: centroid.embedding)

      centroid.destroy!

      expect(MessageCluster.find_by_id(cluster.id)).to be_nil
    end

    it "does nothing when the destroyed message is not a centroid" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      other = create(:message, :outgoing, message_cluster: cluster)
      cluster.update_columns(centroid_message_id: centroid.id, centroid_embedding: centroid.embedding)

      other.destroy!

      cluster.reload
      expect(cluster.centroid_message_id).to eq(centroid.id)
    end
  end

  describe "#leave_cluster" do
    let(:cluster) { create(:message_cluster, question_count: 2) }

    it "decrements the cluster's question_count when a member is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      other = create(:message, :outgoing, message_cluster: cluster)
      cluster.update_columns(centroid_message_id: centroid.id)

      other.destroy!

      expect(cluster.reload.question_count).to eq(1)
    end

    it "decrements the cluster's question_count when the centroid is destroyed" do
      centroid = create(:message, :outgoing, message_cluster: cluster)
      create(:message, :outgoing, message_cluster: cluster, embedding: other_embedding)
      cluster.update_columns(centroid_message_id: centroid.id)

      centroid.destroy!

      expect(cluster.reload.question_count).to eq(1)
    end

    it "deletes the cluster when its last non-centroid member is destroyed" do
      lone_cluster = create(:message_cluster, question_count: 1)
      orphan = create(:message, :outgoing, message_cluster: lone_cluster)

      orphan.destroy!

      expect(MessageCluster.find_by(id: lone_cluster.id)).to be_nil
    end

    it "leaves clusters untouched when the message has no cluster" do
      create(:message, :outgoing, message_cluster: cluster)
      message = create(:message, :outgoing, message_cluster: nil)

      expect { message.destroy! }.not_to change { cluster.reload.question_count }
    end
  end
end
