module WebhookServices
  class BaseService
    # WhatsApp and Telegram both cap outgoing text messages at 4096 characters.
    MAX_TEXT_MESSAGE_LENGTH = 4096

    attr_reader :payload, :hub

    TRACKABLE_DELIVERY_STATUSES = %w[delivered failed].freeze

    def initialize(payload)
      @payload = payload
    end

    def valid?
      raise NotImplementedError, "Subclasses must implement #valid?"
    end

    def process
      raise NotImplementedError, "Subclasses must implement #process"
    end

    protected

    def trackable_delivery_status?(status)
      TRACKABLE_DELIVERY_STATUSES.include?(status)
    end

    # Pass only the error code and message, not the raw callback, which carries phone numbers
    def process_delivery_status_change(message_id, status, error = nil)
      DeliveryStatusChangeWorker.perform_async(message_id, status, error&.to_h&.stringify_keys)
    end

    def find_or_create_external_user(platform_user_data)
      external_user = ExternalUser.find_or_initialize_by_identity(hub, platform_name, platform_user_data[:id])
      adopt_platform_id(external_user, platform_user_data[:id])
      external_user.display_name ||= platform_user_data[:name]
      external_user.metadata = platform_user_data[:raw]
      # Savepoint: webhook processing already runs inside an audit transaction, so a unique-index
      # collision here would abort it and take the rescue's lookup down with it.
      ExternalUser.transaction(requires_new: true) { external_user.save! }
      external_user
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
      hub.external_users.find_by!(platform: platform_name, external_id: platform_user_data[:id])
    end

    # An admin can add a trusted end-user under a number the platform does not identify them by.
    # Adopting the id it sent makes the next message match exactly. Overwrites the only copy.
    def adopt_platform_id(external_user, platform_id)
      if external_user.persisted? && external_user.external_id != platform_id
        LogService.log(:info, "WebhookServices::BaseService",
          "Adopted the #{platform_name} id the platform sent for external user #{external_user.id}")
      end
      external_user.external_id = platform_id
    end

    def find_or_create_conversation(external_user)
      hub.conversations.current_for(external_user, platform_name).first_or_create do |conversation|
        conversation.title = (external_user.trusted_user ? external_user.display_name : "user-#{external_user.id}")
      end
    rescue ActiveRecord::RecordNotUnique, ActiveRecord::RecordInvalid
      hub.conversations.current_for(external_user, platform_name).first!
    end

    def create_message(conversation, message_data)
      metadata = {}
      if message_data[:reply_to_external_id].present?
        replied_to = conversation.messages.find_by(external_id: message_data[:reply_to_external_id])
        metadata[:replied_to_message_id] = replied_to.id if replied_to
      end

      Message.create!(
        conversation: conversation,
        body: message_data[:text],
        direction: :incoming,
        status: :delivered,
        external_id: message_data[:id],
        payload: message_data[:raw],
        metadata: metadata
      )
    end

    def create_unsupported_message(conversation, message_data)
      Message.create!(
        conversation: conversation,
        body: I18n.with_locale(conversation.language) { I18n.t(:error_message_type_unsupported) },
        direction: :outgoing,
        status: :sent,
        state: :unsupported_message,
        external_id: message_data[:id],
        payload: message_data[:raw]
      )
    end

    def create_sources_message(conversation, source_message, callback_payload)
      Message.create!(
        conversation: conversation,
        body: format_sources_message_text(source_message),
        direction: :outgoing,
        status: :sent,
        # A "See More" reply to a topic notification is out-of-band re-engagement, not a Q&A window,
        # so it must not start the inactivity timer (otherwise we'd close the window and prompt the
        # user to subscribe to a topic they already follow). Replies to normal answers keep no state.
        state: (source_message.topic_notification? ? :topic_notification_sources : :interaction_see_sources),
        external_id: "sources_for_#{source_message.id}_#{Time.now.utc.to_f}",
        payload: callback_payload
      )
    end

    def create_error_message(conversation, callback_payload, external_id_prefix, message_key = :message_sources_not_available)
      Message.create!(
        conversation: conversation,
        body: I18n.with_locale(conversation.language) { I18n.t(message_key) },
        direction: :outgoing,
        status: :sent,
        external_id: "#{external_id_prefix}_#{callback_payload["id"] || callback_payload["callback_query_id"]}_#{Time.now.utc.to_f}",
        payload: callback_payload
      )
    end

    def create_subscription_confirmation_message(conversation, topics, callback_payload)
      Message.create!(
        conversation: conversation,
        body: I18n.with_locale(conversation.language) { I18n.t(:"message_subscription_confirmed_#{conversation.hub.tone}", topics: topics.map(&:name).to_sentence) },
        direction: :outgoing,
        status: :sent,
        state: :subscription_confirmed,
        external_id: "subscription_for_#{conversation.id}_#{Time.now.utc.to_f}",
        payload: callback_payload
      )
    end

    def create_unsubscription_confirmation_message(conversation, topics, callback_payload)
      Message.create!(
        conversation: conversation,
        body: I18n.with_locale(conversation.language) { I18n.t(:"message_unsubscription_confirmed_#{conversation.hub.tone}", topic: topics.map(&:name).to_sentence) },
        direction: :outgoing,
        status: :sent,
        state: :unsubscription_confirmed,
        external_id: "unsubscription_for_#{conversation.id}_#{Time.now.utc.to_f}",
        payload: callback_payload
      )
    end

    def format_sources_message_text(message)
      documents_by_url = {}
      # For now, we just return public-facing sources, so: documents from RSS feeds or websites
      message.message_data_source_items.each do |mdsi|
        if mdsi.is_public_source_document?
          # Only add if we haven't seen this URL before (ensures uniqueness)
          documents_by_url[mdsi.item.external_url] ||= mdsi.item
        end
      end
      return I18n.with_locale(message.conversation.language) { I18n.t(:message_no_public_sources_available_for_answer) } if documents_by_url.empty?

      text = documents_by_url.map { |url, document| [document.title, document.content_snippet, url].reject { |part| part.to_s.empty? }.join("\n") }.join("\n\n")
      # If a full digest of long items overflows the platform text limit, drop the snippets
      # (falling back to the title + URL format) rather than truncating mid-entry.
      text = documents_by_url.map { |url, document| "#{document.title}\n#{url}" }.join("\n\n") if text.length > MAX_TEXT_MESSAGE_LENGTH
      text
    end

    def handle_button_callback(callback_data, conversation, callback_payload)
      if callback_data.nil?
        LogService.log(:warn, "WebhookServices::BaseService", "Received a #{platform_name} button callback with no data for conversation #{conversation.id}")
        return
      end

      if callback_data.start_with?("see_sources_")
        source_message_id = callback_data.sub("see_sources_", "").to_i
        source_message = Message.includes(message_data_source_items: {item: :source}).find_by(id: source_message_id, conversation: conversation)

        if source_message&.has_public_source_documents?
          create_sources_message(conversation, source_message, callback_payload)
        else
          create_error_message(conversation, callback_payload, "error")
        end
      elsif callback_data.start_with?("subscribe_")
        handle_subscription(callback_data, conversation, callback_payload)
      elsif callback_data.start_with?("unsubscribe_")
        handle_unsubscription(callback_data, conversation, callback_payload)
      elsif callback_data.start_with?("cancel_contribution_")
        handle_contribution_cancel(conversation, callback_payload)
      end
    end

    def handle_contribution_cancel(conversation, callback_payload)
      return unless conversation.awaiting_contribution?

      conversation.reset_to_normal!
      Message.create!(
        conversation: conversation,
        body: I18n.with_locale(conversation.language) { I18n.t(:contribution_cancel) },
        direction: :outgoing,
        status: :sent,
        state: :bot_contribution_cancelled,
        external_id: "contribution_cancel_for_#{conversation.id}_#{Time.now.utc.to_f}",
        payload: callback_payload
      )
    end

    def handle_subscription(callback_data, conversation, callback_payload)
      message_id = callback_data.sub("subscribe_", "").to_i
      message = Message.find_by(id: message_id, conversation: conversation)
      external_user = conversation.participant
      topics = message&.top_topics

      if topics.blank?
        return create_error_message(conversation, callback_payload, "error", :message_subscription_failed)
      end

      if external_user.is_a?(ExternalUser)
        topics.each { |topic| TopicSubscription.find_or_create_by!(external_user: external_user, topic: topic) }
      end

      create_subscription_confirmation_message(conversation, topics, callback_payload)
    end

    def handle_unsubscription(callback_data, conversation, callback_payload)
      # A merged notification ("topics X and Y") carries every topic it covers in the button payload
      # ("unsubscribe_<id>_<id>..."), and its Unsubscribe button removes all of those subscriptions.
      topic_ids = callback_data.sub("unsubscribe_", "").split("_").map(&:to_i)
      topics = conversation.hub.topics.where(id: topic_ids).to_a.sort_by(&:name)
      external_user = conversation.participant

      if topics.empty? || !external_user.is_a?(ExternalUser)
        return create_error_message(conversation, callback_payload, "error", :message_subscription_failed)
      end

      TopicSubscription.where(external_user: external_user, topic: topics).destroy_all
      create_unsubscription_confirmation_message(conversation, topics, callback_payload)
    end

    def process_reaction(platform, emoji, reacted_message_id)
      # For now, we just log reactions
      LogService.log(:info, "WebhookServices::BaseService", "Reaction emoji received for #{platform} message with ID #{reacted_message_id}: #{emoji}")
    end

    def platform_name
      raise NotImplementedError, "Subclasses must implement #platform_name"
    end

    def secure_compare(a, b)
      return false if a.blank? || b.blank?
      ActiveSupport::SecurityUtils.secure_compare(
        ::Digest::SHA256.hexdigest(a),
        ::Digest::SHA256.hexdigest(b)
      )
    end
  end
end
