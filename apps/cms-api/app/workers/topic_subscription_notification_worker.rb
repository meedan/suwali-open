class TopicSubscriptionNotificationWorker
  include Sidekiq::Worker
  sidekiq_options queue: :notifications, retry: 3

  # At most one notification per subscriber per topic per cooldown window, so a burst of newly
  # ingested documents results in a single digest rather than one message each.
  NOTIFICATION_COOLDOWN = 24.hours

  # Cap on how many items a single digest references (the rest are summarized as "and +X").
  MAX_DIGEST_ITEMS = 10

  # Notifies subscribers of a topic that new data source items with that topic were created.
  # Triggered on every TopicItem creation, but throttled per subscriber: if we already notified
  # them about this topic within NOTIFICATION_COOLDOWN we skip - the new items are simply rolled
  # into the next digest (which covers everything created since their last notification, or since
  # they subscribed). This keeps it event-driven (no daily job) yet bounded to one message per day.
  #
  # We create an outgoing notification message (with the items attached as data source items, so the
  # "See More" button reuses the existing sources flow) in each subscriber's conversation; the normal
  # sender path then delivers it - a template on WhatsApp, a regular message on Telegram, etc.
  def perform(topic_item_id)
    topic_item = TopicItem.find_by(id: topic_item_id)
    return unless topic_item

    # We only notify about public-source documents (the ones we can show via "See More"), so unless
    # the item that triggered this is one, there's nothing to send.
    item = topic_item.item
    return unless item.is_a?(Document) && item.public_source?

    topic = topic_item.topic
    return unless topic

    hub = topic.hub
    tone = hub.tone

    topic.topic_subscriptions.includes(:external_user).find_each do |subscription|
      external_user = subscription.external_user
      conversation = hub.conversations.current_for(external_user, external_user.platform).take
      next unless conversation

      # Don't interrupt a live chat: notifications re-engage idle users, and mid-conversation they're
      # already engaged. Skipping leaves last_sent untouched, so the held items roll into the digest
      # for the next document once the window has closed.
      next if conversation.recently_active?

      notify_subscriber(conversation, subscription, tone, item)
    end
  end

  private

  # Builds and sends one digest for a subscriber. Topics whose digest would cover the exact same set
  # of documents are merged into a single message ("topics X and Y: ...") instead of one message per
  # topic. A merged topic's pending set always contains the triggering document (it equals the trigger
  # topic's set), so only the subscriber's topics that also include that document are merge candidates.
  #
  # The TopicSubscription rows are the natural "(this user, this topic)" locks: locking every candidate
  # (in id order, so concurrent workers can't deadlock) runs the cooldown checks and the message
  # creation in one transaction, so the workers spawned by the other topics of the same document can't
  # double-send - the second worker waits, then sees the just-committed notification covering its topic
  # in the cooldown check and skips.
  def notify_subscriber(conversation, subscription, tone, document)
    ActiveRecord::Base.transaction do
      candidates = TopicSubscription
        .where(external_user_id: subscription.external_user_id)
        .where(topic_id: TopicItem.where(item: document).select(:topic_id))
        .order(:id)
        .lock
        .to_a
      pending = candidates.to_h { |candidate| [candidate, pending_document_ids(conversation, candidate)] }

      document_ids = pending[candidates.find { |candidate| candidate.id == subscription.id }]
      next if document_ids.blank?

      merged = candidates.select { |candidate| pending[candidate]&.sort == document_ids.sort }
      topics = merged.map(&:topic).sort_by(&:name)
      items = Document.where(id: document_ids.first(MAX_DIGEST_ITEMS)).order(created_at: :desc).to_a

      content = Message.notification_content_summary(items.map { |item| item.title.to_s }, items.first.external_url, conversation.language)
      body = I18n.with_locale(conversation.language) do
        I18n.t(:"topic_notification_body_#{tone}", topic: topics.map(&:name).to_sentence, content: content)
      end

      # Attach the items explicitly (so "See More" reuses the sources flow) rather than relying on the
      # document_ids_cited metadata convention used for chat answers. They share this transaction so the
      # send (message after_commit) only fires once the data source items are in place.
      message = conversation.messages.create!(
        direction: "outgoing",
        state: :topic_notification,
        body: body,
        metadata: {"notification_topic_ids" => topics.map(&:id).sort}
      )
      items.each { |item| message.message_data_source_items.create!(item: item) }
    end
  end

  # The ids of the documents a digest for this subscription would cover right now (newest first), or
  # nil when the subscription is inside its cooldown window. Returns the full list, not capped at
  # MAX_DIGEST_ITEMS, since topics are only merged when their exact pending sets match.
  def pending_document_ids(conversation, subscription)
    topic = subscription.topic
    # Only consider notifications created since the user subscribed - one can't exist any earlier,
    # so the result is the same as scanning the whole conversation, but Postgres scans far fewer rows.
    # Messages created before digests could merge topics carry a single "notification_topic_id".
    last_sent = conversation.messages
      .where(state: :topic_notification)
      .where("created_at > ?", subscription.created_at)
      .where("metadata->'notification_topic_ids' @> :as_json_array OR metadata->>'notification_topic_id' = :as_string",
        as_json_array: [topic.id].to_json, as_string: topic.id.to_s)
      .maximum(:created_at)
    return nil if last_sent && last_sent > NOTIFICATION_COOLDOWN.ago

    since = last_sent || subscription.created_at
    # Only public-source documents: these are the ones we can actually show via "See More", so the
    # digest summary ("first title and +N") counts the same set, never something the user can't open.
    # The window is based on when the document was created, not when it was classified: backfilling
    # topics onto old documents (e.g. via rake task) must not surface stale content as "new".
    Document.public_source
      .where(source: topic.hub.sources)
      .where(id: topic.topic_items.where(item_type: "Document").select(:item_id))
      .where("documents.created_at > ?", since)
      .order(created_at: :desc)
      .pluck(:id)
  end
end
