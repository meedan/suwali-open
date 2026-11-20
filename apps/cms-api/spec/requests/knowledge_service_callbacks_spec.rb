require "rails_helper"

RSpec.describe "Knowledge Service Callbacks", type: :request do
  let(:valid_token) { "test_callback_token_123" }

  before do
    ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = valid_token
  end

  describe "POST /api/knowledge-service-callbacks/update-sync-status" do
    context "with valid token and Document" do
      let(:document) { create(:document) }
      let(:encoded_id) { Base64.strict_encode64("Document/#{document.id}") }

      it "updates sync_status to complete when success is true" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(document.reload.sync_status).to eq("complete")
      end

      it "updates sync_status to error when success is false" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false}

        expect(response).to have_http_status(:ok)
        expect(document.reload.sync_status).to eq("error")
      end

      it "updates sync_status to complete when success is string 'true'" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: "true"}

        expect(response).to have_http_status(:ok)
        expect(document.reload.sync_status).to eq("complete")
      end

      it "stores the extracted topics on the document's hub" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", "Elections"]}

        expect(response).to have_http_status(:ok)
        expect(document.reload.topics.map(&:name)).to match_array(["Climate", "Elections"])
        expect(document.topics.map(&:hub_id).uniq).to eq([document.hub.id])
      end

      it "reuses existing topics instead of duplicating them" do
        existing = document.hub.topics.create!(name: "Climate")

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate"]}

        expect(document.reload.topics).to eq([existing])
        expect(document.hub.topics.where(name: "Climate").count).to eq(1)
      end

      it "does not store topics when success is false" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false, topics: ["Climate"]}

        expect(document.reload.topics).to be_empty
      end

      it "keeps previously stored topics when a retry returns no topics" do
        document.hub.topics.create!(name: "Climate").tap { |topic| document.topics << topic }

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: []}

        expect(response).to have_http_status(:ok)
        expect(document.reload.topics.map(&:name)).to eq(["Climate"])
      end

      it "keeps the topics a user added to the document" do
        document.topic_items.create!(topic: document.hub.topics.create!(name: "Housing"), added_by: create(:user))

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate"]}

        expect(response).to have_http_status(:ok)
        expect(document.reload.topics.map(&:name)).to match_array(["Housing", "Climate"])
      end

      it "does not add back a topic a user removed from the document" do
        create(:deleted_topic_item, topic: document.hub.topics.create!(name: "Climate"), item: document)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", "Elections"]}

        expect(response).to have_http_status(:ok)
        expect(document.reload.topics.map(&:name)).to eq(["Elections"])
      end

      it "does not record the generated topics it replaces as removed" do
        document.topic_items.create!(topic: document.hub.topics.create!(name: "Elections"))

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate"]}

        expect(response).to have_http_status(:ok)
        expect(DeletedTopicItem.count).to eq(0)
      end

      it "stores topics for documents of a preloaded source" do
        preloaded_document = create(:document, source: create(:source, preloaded: true))

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: Base64.strict_encode64("Document/#{preloaded_document.id}"), token: valid_token, success: true, topics: ["Climate"]}

        expect(response).to have_http_status(:ok)
        expect(preloaded_document.reload.sync_status).to eq("complete")
        expect(preloaded_document.topics.map(&:name)).to eq(["Climate"])
        expect(preloaded_document.hub.topics.map(&:name)).to eq(["Climate"])
      end

      it "ignores blank and duplicate topic names" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", " Climate ", "", "  "]}

        expect(document.reload.topics.map(&:name)).to eq(["Climate"])
      end

      it "enqueues one topics sync on success" do
        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", "Elections"]}
        }.to change { sync_topics_jobs.size }.by(1)

        expect(sync_topics_jobs.last["args"]).to eq(["sync_topics", "Document/#{document.id}"])
      end

      it "enqueues a sync on success when the Knowledge Service suggested no topics" do
        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: true}
        }.to change { sync_topics_jobs.size }.by(1)
      end

      it "does not enqueue a sync when success is false" do
        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: false, topics: ["Climate"]}
        }.not_to change { sync_topics_jobs.size }

        expect(response).to have_http_status(:ok)
      end

      it "does not enqueue a sync when the document is inactive" do
        document.update_columns(active: false)

        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: true}
        }.not_to change { sync_topics_jobs.size }

        expect(response).to have_http_status(:ok)
      end

      it "persists the error_code when success is false and error_code is present" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false, error_code: "NO_TEXT_FOUND"}

        expect(response).to have_http_status(:ok)
        expect(document.reload.last_sync_error_code).to eq("NO_TEXT_FOUND")
      end

      it "does not set an error_code when success is false and error_code is absent" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false}

        expect(response).to have_http_status(:ok)
        expect(document.reload.last_sync_error_code).to be_nil
      end

      it "clears a previously stored error_code when success is true" do
        document.update_column(:last_sync_error_code, "TEXT_TOO_LARGE")

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(document.reload.last_sync_error_code).to be_nil
      end

      it "retries item summary generation on success" do
        notebook = create(:notebook, hub: document.hub)
        create(:notebook_item, notebook: notebook, item: document)

        expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook.id)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}
      end

      it "retries item summary generation on failure" do
        notebook = create(:notebook, hub: document.hub)
        create(:notebook_item, notebook: notebook, item: document)

        expect(ItemSummaryWorker).to receive(:perform_async).with("Document", document.id, notebook.id)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false}
      end

      it "does not retry item summary generation when the document already has an ai_summary" do
        notebook = create(:notebook, hub: document.hub)
        create(:notebook_item, notebook: notebook, item: document)
        document.update_column(:ai_summary, "Existing summary")

        expect(ItemSummaryWorker).not_to receive(:perform_async)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}
      end
    end

    context "with valid token and Notebook" do
      let(:notebook) { create(:notebook) }
      let(:encoded_id) { Base64.strict_encode64("Notebook/#{notebook.id}") }

      it "updates sync_status to complete when success is true" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(notebook.reload.sync_status).to eq("complete")
      end

      it "enqueues a sync of the topics when the notebook is published" do
        notebook.update_columns(published: true)

        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: true}
        }.to change { sync_topics_jobs.size }.by(1)
      end

      it "does not enqueue a sync when the notebook is unpublished" do
        expect {
          post "/api/knowledge-service-callbacks/update-sync-status",
            params: {id: encoded_id, token: valid_token, success: true}
        }.not_to change { sync_topics_jobs.size }

        expect(response).to have_http_status(:ok)
      end

      it "does not raise when the record has no item summary generation to retry" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
      end

      it "persists the error_code when success is false and error_code is present" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false, error_code: "NO_TEXT_FOUND"}

        expect(response).to have_http_status(:ok)
        expect(notebook.reload.last_sync_error_code).to eq("NO_TEXT_FOUND")
      end

      it "clears a previously stored error_code when success is true" do
        notebook.update_column(:last_sync_error_code, "TEXT_TOO_LARGE")

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(notebook.reload.last_sync_error_code).to be_nil
      end

      it "keeps the topics a user added to the notebook" do
        notebook.topic_items.create!(topic: notebook.hub.topics.create!(name: "Housing"), added_by: create(:user))

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate"]}

        expect(response).to have_http_status(:ok)
        expect(notebook.reload.topics.map(&:name)).to match_array(["Housing", "Climate"])
      end

      it "does not add back a topic a user removed from the notebook" do
        create(:deleted_topic_item, topic: notebook.hub.topics.create!(name: "Climate"), item: notebook)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", "Elections"]}

        expect(response).to have_http_status(:ok)
        expect(notebook.reload.topics.map(&:name)).to eq(["Elections"])
      end
    end

    context "with valid token and Contribution" do
      let(:contribution) { create(:contribution) }
      let(:encoded_id) { Base64.strict_encode64("Contribution/#{contribution.id}") }

      it "updates sync_status to complete when success is true" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(contribution.reload.sync_status).to eq("complete")
      end

      it "persists the error_code when success is false and error_code is present" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: false, error_code: "NO_TEXT_FOUND"}

        expect(response).to have_http_status(:ok)
        expect(contribution.reload.last_sync_error_code).to eq("NO_TEXT_FOUND")
      end

      it "clears a previously stored error_code when success is true" do
        contribution.update_column(:last_sync_error_code, "TEXT_TOO_LARGE")

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:ok)
        expect(contribution.reload.last_sync_error_code).to be_nil
      end

      it "keeps the topics a user added to the contribution" do
        contribution.topic_items.create!(topic: contribution.hub.topics.create!(name: "Housing"), added_by: create(:user))

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate"]}

        expect(response).to have_http_status(:ok)
        expect(contribution.reload.topics.map(&:name)).to match_array(["Housing", "Climate"])
      end

      it "does not add back a topic a user removed from the contribution" do
        create(:deleted_topic_item, topic: contribution.hub.topics.create!(name: "Climate"), item: contribution)

        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true, topics: ["Climate", "Elections"]}

        expect(response).to have_http_status(:ok)
        expect(contribution.reload.topics.map(&:name)).to eq(["Elections"])
      end
    end

    context "with invalid token" do
      let(:document) { create(:document) }
      let(:encoded_id) { Base64.strict_encode64("Document/#{document.id}") }

      it "returns unauthorized" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: "invalid_token", success: true}

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with missing token" do
      let(:document) { create(:document) }
      let(:encoded_id) { Base64.strict_encode64("Document/#{document.id}") }

      it "returns unauthorized" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, success: true}

        expect(response).to have_http_status(:unauthorized)
      end
    end

    context "with missing id" do
      it "returns unprocessable entity" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {token: valid_token, success: true}

        expect(response).to have_http_status(:unprocessable_content)
      end
    end

    context "with invalid Base64 id" do
      it "returns unprocessable entity" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: "not-valid-base64!!!", token: valid_token, success: true}

        expect(response).to have_http_status(:unprocessable_content)
      end
    end

    context "with unsupported class" do
      let(:encoded_id) { Base64.strict_encode64("UnsupportedClass/123") }

      it "returns unprocessable entity" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:unprocessable_content)
      end
    end

    context "with non-existent record" do
      let(:encoded_id) { Base64.strict_encode64("Document/999999") }

      it "returns not found" do
        post "/api/knowledge-service-callbacks/update-sync-status",
          params: {id: encoded_id, token: valid_token, success: true}

        expect(response).to have_http_status(:not_found)
      end
    end
  end

  describe "POST /api/knowledge-service-callbacks/update-chat-status" do
    let(:incoming_message) { create(:message, :incoming) }

    def post_chat_status(payload, message_id:, token: valid_token)
      post "/api/knowledge-service-callbacks/update-chat-status?message_id=#{message_id}&token=#{token}",
        params: payload.to_json,
        headers: {"Content-Type" => "application/json"}
    end

    context "with complete status" do
      it "creates an outgoing answer message" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "The answer is 42",
            "metadata" => {"documents_count" => 3},
            "error_type" => nil
          }
        }

        expect {
          post_chat_status(payload, message_id: incoming_message.id)
        }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)

        expect(response).to have_http_status(:ok)
        reply = incoming_message.conversation.messages.outgoing.last
        expect(reply.body).to eq("The answer is 42")
        expect(reply.reply_to).to eq(incoming_message)
      end

      it "is idempotent - does not create duplicate answers" do
        create(:message, :outgoing, conversation: incoming_message.conversation, reply_to: incoming_message)

        expect {
          post_chat_status({"status" => "complete", "payload" => {"answer" => "duplicate"}}, message_id: incoming_message.id)
        }.not_to change { incoming_message.conversation.messages.count }

        expect(response).to have_http_status(:ok)
      end

      it "stores the extracted topics on the incoming message" do
        payload = {
          "status" => "complete",
          "payload" => {"answer" => "The answer is 42", "topics" => ["Climate", "Elections"]}
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(incoming_message.reload.topics.map(&:name)).to match_array(["Climate", "Elections"])
        expect(incoming_message.topics.map(&:hub_id).uniq).to eq([incoming_message.hub.id])
      end

      it "reuses existing hub topics instead of duplicating them" do
        hub = incoming_message.hub
        existing = hub.topics.create!(name: "Climate")

        post_chat_status({"status" => "complete", "payload" => {"answer" => "x", "topics" => ["Climate"]}}, message_id: incoming_message.id)

        expect(incoming_message.reload.topics).to eq([existing])
        expect(hub.topics.where(name: "Climate").count).to eq(1)
      end

      it "stores topics even when the question could not be answered, so the user can be notified later" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "Sorry, I couldn't find an answer",
            "error_type" => "no_answer_available",
            "metadata" => {"answerable" => false},
            "topics" => ["Climate"]
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(incoming_message.reload.topics.map(&:name)).to eq(["Climate"])
      end

      it "leaves the message without topics when the payload has none" do
        post_chat_status({"status" => "complete", "payload" => {"answer" => "x"}}, message_id: incoming_message.id)

        expect(incoming_message.reload.topics).to be_empty
      end

      it "applies the context updates to the conversation" do
        conversation = incoming_message.conversation
        conversation.update!(context: [{"id" => "n1", "text" => "Lives in Nairobi"}])
        payload = {
          "status" => "complete",
          "payload" => {"answer" => "x", "context_updates" => [{"op" => "remove", "id" => "n1"}, {"op" => "add", "text" => "Lives in Lagos"}]}
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(conversation.reload.context).to match([hash_including("text" => "Lives in Lagos", "message_id" => incoming_message.id)])
      end

      it "still creates the answer when applying the context updates fails" do
        allow_any_instance_of(Conversation).to receive(:apply_context_updates!).and_raise(ActiveRecord::RecordInvalid)
        expect(LogService).to receive(:log).with(:error, "KnowledgeServiceCallbacksController", /Error applying context updates/)
        payload = {"status" => "complete", "payload" => {"answer" => "x", "context_updates" => [{"op" => "add", "text" => "Lives in Lagos"}]}}

        expect {
          post_chat_status(payload, message_id: incoming_message.id)
        }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)
        expect(response).to have_http_status(:ok)
      end

      it "marks the reply as non_question_reply when the router classified it as such" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "Hi there!",
            "metadata" => {"router_intent" => "non_question"}
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        reply = incoming_message.conversation.messages.outgoing.last
        expect(reply.state).to eq("non_question_reply")
      end

      it "marks a location acknowledgment as non_question_reply so it stays out of the history" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "I have noted that you are in Lagos. What would you like to know?",
            "metadata" => {"router_intent" => "location_noted"}
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        reply = incoming_message.conversation.messages.outgoing.last
        expect(reply.state).to eq("non_question_reply")
      end
    end

    context "with error status" do
      it "creates an error message" do
        expect {
          post_chat_status({"status" => "error"}, message_id: incoming_message.id)
        }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)

        expect(response).to have_http_status(:ok)
        error_msg = incoming_message.conversation.messages.outgoing.last
        expect(error_msg.body).to eq(I18n.t(:error_create_chat_response_message))
        expect(error_msg.state).to eq("knowledge_service_error")
        expect(error_msg.reply_to).to eq(incoming_message)
      end

      it "is idempotent - does not create duplicate error messages" do
        create(:message, :outgoing, conversation: incoming_message.conversation, reply_to: incoming_message)

        expect {
          post_chat_status({"status" => "error"}, message_id: incoming_message.id)
        }.not_to change { incoming_message.conversation.messages.count }

        expect(response).to have_http_status(:ok)
      end
    end

    context "with intermediary status" do
      it "creates an intermediary message for the evaluating_results status" do
        expect {
          post_chat_status({"status" => "evaluating_results"}, message_id: incoming_message.id)
        }.to change { incoming_message.conversation.messages.outgoing.count }.by(1)

        expect(response).to have_http_status(:ok)
        intermediary = incoming_message.conversation.messages.outgoing.last
        expect(intermediary.state).to eq("bot_intermediary_message")
        expect(intermediary.metadata).to eq({"step" => "evaluating_results"})
      end

      it "does not create a message for the earlier intermediary statuses" do
        expect {
          post_chat_status({"status" => "parsing_question"}, message_id: incoming_message.id)
          post_chat_status({"status" => "searching_sources"}, message_id: incoming_message.id)
        }.not_to change { incoming_message.conversation.messages.count }

        expect(response).to have_http_status(:ok)
      end

      it "ignores unknown statuses" do
        expect {
          post_chat_status({"status" => "unknown_status"}, message_id: incoming_message.id)
        }.not_to change { incoming_message.conversation.messages.count }

        expect(response).to have_http_status(:ok)
      end

      it "does not create intermediary if answer already delivered" do
        create(:message, :outgoing, conversation: incoming_message.conversation, reply_to: incoming_message)

        expect {
          post_chat_status({"status" => "evaluating_results"}, message_id: incoming_message.id)
        }.not_to change { incoming_message.conversation.messages.count }
      end

      ["whatsapp", "telegram"].each do |platform|
        context "for a #{platform} conversation" do
          let(:platform_message) do
            create(:message, :incoming,
              conversation: create(:conversation, platform: platform, participant: create(:external_user, platform: platform, external_id: "uid")),
              external_id: "external123")
          end

          before do
            platform_message # created first so its first-message typing indicator isn't counted
            allow(TypingIndicatorWorker).to receive(:perform_async)
          end

          it "sends a typing indicator instead of creating an intermediary message" do
            expect {
              post_chat_status({"status" => "searching_sources"}, message_id: platform_message.id)
            }.not_to change { platform_message.conversation.messages.outgoing.count }

            expect(response).to have_http_status(:ok)
            expect(TypingIndicatorWorker).to have_received(:perform_async).with(platform_message.id)
          end

          it "creates an actual message for the evaluating_results status" do
            expect {
              post_chat_status({"status" => "evaluating_results"}, message_id: platform_message.id)
            }.to change { platform_message.conversation.messages.outgoing.count }.by(1)

            expect(platform_message.conversation.messages.outgoing.last.metadata).to eq({"step" => "evaluating_results"})
            expect(TypingIndicatorWorker).not_to have_received(:perform_async)
          end

          it "still updates the conversation language" do
            post_chat_status({"status" => "parsing_question", "payload" => {"language" => "ar"}}, message_id: platform_message.id)

            expect(platform_message.conversation.reload.language).to eq("ar")
          end
        end
      end
    end

    context "with language in metadata" do
      it "updates conversation language from metadata" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "The answer",
            "metadata" => {"language" => "ar"},
            "error_type" => nil
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(incoming_message.conversation.reload.language).to eq("ar")
      end

      it "does not update conversation language when metadata has no language" do
        incoming_message.conversation.update_column(:language, "pt")

        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "The answer",
            "metadata" => {},
            "error_type" => nil
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(incoming_message.conversation.reload.language).to eq("pt")
      end
    end

    context "with error status and non-default language" do
      it "uses conversation language for error message" do
        incoming_message.conversation.update_column(:language, "pt")

        post_chat_status({"status" => "error"}, message_id: incoming_message.id)

        error_msg = incoming_message.conversation.messages.outgoing.last
        expect(error_msg.body).to eq(I18n.t(:error_create_chat_response_message, locale: :pt))
      end
    end

    context "with answerable metadata" do
      it "sets answered to true when answerable is true and no error_type" do
        payload = {
          "status" => "complete",
          "payload" => {
            "answer" => "Here is your answer",
            "metadata" => {"answerable" => true, "documents_count" => 2},
            "error_type" => nil
          }
        }

        post_chat_status(payload, message_id: incoming_message.id)

        reply = incoming_message.conversation.messages.outgoing.last
        expect(reply.answered).to be true
      end
    end

    context "when message creation fails" do
      it "creates an error message as fallback" do
        allow_any_instance_of(ActiveRecord::Associations::CollectionProxy).to receive(:create!).and_call_original
        allow_any_instance_of(ActiveRecord::Associations::CollectionProxy).to receive(:create!)
          .with(hash_including(body: "Here is your answer"))
          .and_raise(StandardError, "unexpected failure")

        payload = {
          "status" => "complete",
          "payload" => {"answer" => "Here is your answer", "metadata" => {}}
        }

        post_chat_status(payload, message_id: incoming_message.id)

        expect(response).to have_http_status(:ok)
        error_msg = incoming_message.conversation.messages.outgoing.last
        expect(error_msg.body).to eq(I18n.t(:error_create_chat_response_message))
        expect(error_msg.state).to eq("knowledge_service_error")
      end
    end

    context "with invalid JSON body" do
      it "returns bad request" do
        post "/api/knowledge-service-callbacks/update-chat-status?message_id=#{incoming_message.id}&token=#{valid_token}",
          params: "not valid json",
          headers: {"Content-Type" => "text/plain"}

        expect(response).to have_http_status(:bad_request)
      end
    end

    context "with invalid request" do
      it "returns not found for non-existent message" do
        post_chat_status({"status" => "complete", "payload" => {"answer" => "test"}}, message_id: 0)
        expect(response).to have_http_status(:not_found)
      end

      it "returns unauthorized with invalid token" do
        post_chat_status({"status" => "complete", "payload" => {"answer" => "test"}}, message_id: incoming_message.id, token: "wrong")
        expect(response).to have_http_status(:unauthorized)
      end
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Knowledge Service Callbacks API" do
  path "/api/knowledge-service-callbacks/update-sync-status" do
    post "Updates the sync status of a document, notebook, or contribution" do
      tags "Knowledge Service Callbacks"
      consumes "application/json"
      security []
      parameter name: :token, in: :query, type: :string, required: true, description: "Authentication token for Knowledge Service callbacks"
      parameter name: :id, in: :query, type: :string, required: true, description: "Base64-encoded identifier in format 'ClassName/id' (e.g., 'Document/123')"
      parameter name: :success, in: :query, type: :boolean, required: true, description: "Whether the sync operation was successful"

      response "200", "Sync status updated successfully" do
        let(:document) { create(:document) }
        let(:id) { Base64.strict_encode64("Document/#{document.id}") }
        let(:token) { "test_callback_token_123" }
        let(:success) { true }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = token
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
          expect(document.reload.sync_status).to eq("complete")
        end
      end

      response "401", "Unauthorized - invalid or missing token" do
        let(:document) { create(:document) }
        let(:id) { Base64.strict_encode64("Document/#{document.id}") }
        let(:token) { "invalid_token" }
        let(:success) { true }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = "test_callback_token_123"
        end

        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - record does not exist" do
        let(:id) { Base64.strict_encode64("Document/999999") }
        let(:token) { "test_callback_token_123" }
        let(:success) { true }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = token
        end

        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "Unprocessable entity - invalid id format or unsupported class" do
        let(:id) { "not-valid-base64!!!" }
        let(:token) { "test_callback_token_123" }
        let(:success) { true }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = token
        end

        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/knowledge-service-callbacks/update-chat-status" do
    post "Receives chat status updates from the Knowledge Service" do
      tags "Knowledge Service Callbacks"
      consumes "application/json"
      security []
      parameter name: :token, in: :query, type: :string, required: true, description: "Authentication token for Knowledge Service callbacks"
      parameter name: :message_id, in: :query, type: :integer, required: true, description: "ID of the incoming message being answered"
      parameter name: :body, in: :body, schema: {
        type: :object,
        properties: {
          status: {type: :string, enum: %w[parsing_question searching_sources evaluating_results complete error], description: "Pipeline status identifier"},
          payload: {
            type: :object,
            nullable: true,
            description: "Present only for 'complete' status",
            properties: {
              answer: {type: :string, description: "The generated answer"},
              metadata: {type: :object, description: "Response metadata (documents_count, query_tokens, etc.)"},
              error_type: {type: :string, nullable: true, description: "Error type if applicable"}
            }
          }
        },
        required: %w[status]
      }

      response "200", "Status update processed successfully" do
        let(:message) { create(:message, :incoming) }
        let(:message_id) { message.id }
        let(:token) { "test_callback_token_123" }
        let(:body) { {status: "complete", payload: {answer: "The answer", metadata: {}, error_type: nil}} }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = token
        end

        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized - invalid or missing token" do
        let(:message) { create(:message, :incoming) }
        let(:message_id) { message.id }
        let(:token) { "invalid_token" }
        let(:body) { {status: "complete", payload: {answer: "test"}} }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = "test_callback_token_123"
        end

        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found - message does not exist" do
        let(:message_id) { 0 }
        let(:token) { "test_callback_token_123" }
        let(:body) { {status: "complete", payload: {answer: "test"}} }

        before do
          ENV["KNOWLEDGE_SERVICE_CALLBACK_TOKEN"] = token
        end

        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
