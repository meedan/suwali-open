require "rails_helper"

RSpec.describe WebhookServices::WhatsappService, type: :service do
  let(:app_secret) { "test_app_secret" }
  let(:verify_token) { "test_verify_token" }
  let(:service) { described_class.new(app_secret, verify_token) }
  let(:phone_number_id) { "1234567890" }
  let!(:integration) { create(:whatsapp_messaging_integration, credentials: {phone_number_id: phone_number_id}, active: true) }

  describe "#handle_verification" do
    it "returns ok with challenge when mode is subscribe and token matches" do
      params = {
        "hub.mode" => "subscribe",
        "hub.verify_token" => verify_token,
        "hub.challenge" => "test_challenge"
      }

      result = service.handle_verification(params)
      expect(result).to eq([:ok, "test_challenge", "text/plain"])
    end

    it "returns forbidden when mode is not subscribe" do
      params = {
        "hub.mode" => "unsubscribe",
        "hub.verify_token" => verify_token,
        "hub.challenge" => "test_challenge"
      }

      result = service.handle_verification(params)
      expect(result).to eq([:forbidden, "", "text/plain"])
    end

    it "returns forbidden when token does not match" do
      params = {
        "hub.mode" => "subscribe",
        "hub.verify_token" => "wrong_token",
        "hub.challenge" => "test_challenge"
      }

      result = service.handle_verification(params)
      expect(result).to eq([:forbidden, "", "text/plain"])
    end
  end

  describe "#valid?" do
    let(:request) { instance_double(ActionDispatch::Request) }
    let(:raw_post) { "test_payload" }
    let(:computed_signature) { OpenSSL::HMAC.hexdigest("SHA256", app_secret, raw_post) }

    before do
      allow(request).to receive(:raw_post).and_return(raw_post)
    end

    it "returns true when signature is valid" do
      headers = {"X-Hub-Signature-256" => "sha256=#{computed_signature}"}
      allow(request).to receive(:headers).and_return(headers)

      expect(service.valid?(request)).to be(true)
    end

    it "returns false when signature header does not start with sha256=" do
      headers = {"X-Hub-Signature-256" => "invalid_signature"}
      allow(request).to receive(:headers).and_return(headers)

      expect(service.valid?(request)).to be(false)
    end

    it "returns false when signature is invalid" do
      headers = {"X-Hub-Signature-256" => "sha256=invalid_signature"}
      allow(request).to receive(:headers).and_return(headers)

      expect(service.valid?(request)).to be(false)
    end

    it "returns false when signature is blank" do
      headers = {"X-Hub-Signature-256" => "sha256="}
      allow(request).to receive(:headers).and_return(headers)

      expect(service.valid?(request)).to be(false)
    end

    it "returns false when app_secret is blank" do
      service_with_blank_secret = described_class.new("", verify_token)
      headers = {"X-Hub-Signature-256" => "sha256=#{computed_signature}"}
      allow(request).to receive(:headers).and_return(headers)

      expect(service_with_blank_secret.valid?(request)).to be(false)
    end
  end

  describe "#valid_payload?" do
    it "returns true for valid whatsapp payload" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "type" => "text",
                "text" => {"body" => "Hello"},
                "from" => "1234567890"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(true)
    end

    it "returns false when object is not whatsapp_business_account" do
      payload = {
        "object" => "page",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "text" => {"body" => "Hello"},
                "from" => "1234567890"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(false)
    end

    it "returns true when message body is not present but sender is identified with a user message type" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "type" => "image",
                "from" => "1234567890"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(true)
    end

    it "returns true for reaction message types" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "type" => "reaction",
                "from" => "1234567890",
                "reaction" => {"message_id" => "msg_123", "emoji" => "\u{1F44D}"}
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(true)
    end

    it "returns false when neither from nor from_user_id is present" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "text" => {"body" => "Hello"}
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(false)
    end

    it "returns true when from is absent but from_user_id is present" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "messages" => [{
                "type" => "text",
                "text" => {"body" => "Hello"},
                "from_user_id" => "US.1349120865530274"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(true)
    end

    it "returns true for valid delivery failure payload" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "statuses" => [{
                "id" => "wamid.XXXX",
                "status" => "failed"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(true)
    end

    it "returns false for delivery failure payload without message id" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "statuses" => [{
                "id" => "",
                "status" => "failed"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(false)
    end

    it "returns false for non-failure status payloads" do
      payload = {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "value" => {
              "statuses" => [{
                "id" => "wamid.XXXX",
                "status" => "unknown"
              }]
            }
          }]
        }]
      }

      expect(service.valid_payload?(payload)).to be(false)
    end
  end

  describe "#process" do
    let(:request) { instance_double(ActionDispatch::Request) }
    let(:payload) do
      {
        "object" => "whatsapp_business_account",
        "entry" => [{
          "changes" => [{
            "field" => "messages",
            "value" => {
              "metadata" => {
                "phone_number_id" => phone_number_id
              },
              "contacts" => [{
                "wa_id" => "1111111111",
                "profile" => {
                  "name" => "John Doe"
                }
              }],
              "messages" => [{
                "id" => "message_123",
                "type" => "text",
                "text" => {
                  "body" => "Hello, this is a test message!"
                },
                "from" => "1111111111"
              }]
            }
          }]
        }]
      }
    end

    before do
      allow(request).to receive(:raw_post).and_return(payload.to_json)
    end

    it "parses payload and creates data" do
      expect {
        service.process(request)
      }.to change(ExternalUser, :count).by(1)
        .and change(Conversation, :count).by(1)
        .and change(Message, :count).by(1)
    end

    context "when the sender is in cooldown" do
      let!(:external_user) { create(:external_user, hub: integration.hub, platform: "whatsapp", external_id: "1111111111") }

      let(:cooldown) { ExternalUserCooldown.new(external_user) }

      before { cooldown.start! }

      after { cooldown.reset! }

      it "ignores the incoming message" do
        expect {
          service.process(request)
        }.not_to change(Message, :count)
      end

      it "still acts on a button callback" do
        topic = integration.hub.topics.create!(name: "Climate")
        subscription = TopicSubscription.create!(topic: topic, external_user: external_user)
        payload["entry"][0]["changes"][0]["value"]["messages"][0] = {
          "id" => "message_456",
          "type" => "button",
          "button" => {"payload" => "unsubscribe_#{topic.id}"},
          "from" => "1111111111"
        }
        allow(request).to receive(:raw_post).and_return(payload.to_json)

        service.process(request)

        expect(TopicSubscription.exists?(subscription.id)).to be(false)
      end
    end

    it "returns early when payload is invalid" do
      invalid_payload = {"object" => "page"}
      allow(request).to receive(:raw_post).and_return(invalid_payload.to_json)

      expect {
        service.process(request)
      }.not_to change(ExternalUser, :count)
    end

    it "skips entry when field is not messages" do
      payload_with_different_field = payload.deep_dup
      payload_with_different_field["entry"][0]["changes"][0]["field"] = "statuses"
      allow(request).to receive(:raw_post).and_return(payload_with_different_field.to_json)

      expect {
        service.process(request)
      }.not_to change(ExternalUser, :count)
    end

    it "skips entry when phone_number_id is blank" do
      payload_without_phone = payload.deep_dup
      payload_without_phone["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = ""
      allow(request).to receive(:raw_post).and_return(payload_without_phone.to_json)

      expect {
        service.process(request)
      }.not_to change(ExternalUser, :count)
    end

    it "skips entry when hub is not found" do
      payload_with_unknown_phone = payload.deep_dup
      payload_with_unknown_phone["entry"][0]["changes"][0]["value"]["metadata"]["phone_number_id"] = "unknown_phone"
      allow(request).to receive(:raw_post).and_return(payload_with_unknown_phone.to_json)

      expect {
        service.process(request)
      }.not_to change(ExternalUser, :count)
    end

    it "uses wa_id as name when profile name is not present" do
      payload_without_name = payload.deep_dup
      payload_without_name["entry"][0]["changes"][0]["value"]["contacts"][0].delete("profile")
      allow(request).to receive(:raw_post).and_return(payload_without_name.to_json)

      expect {
        service.process(request)
      }.to change(ExternalUser, :count).by(1)

      external_user = ExternalUser.last
      expect(external_user.display_name).to eq("1111111111")
    end

    context "when webhook includes user_id (BSUID)" do
      it "uses wa_id as external_id when both wa_id and user_id are present" do
        bsuid_payload = payload.deep_dup
        bsuid_payload["entry"][0]["changes"][0]["value"]["contacts"][0]["user_id"] = "US.1349120865530274"
        bsuid_payload["entry"][0]["changes"][0]["value"]["messages"][0]["from_user_id"] = "US.1349120865530274"
        allow(request).to receive(:raw_post).and_return(bsuid_payload.to_json)

        service.process(request)

        external_user = ExternalUser.last
        expect(external_user.external_id).to eq("1111111111")
      end

      it "uses user_id as external_id when wa_id is absent" do
        bsuid_only_payload = payload.deep_dup
        bsuid_only_payload["entry"][0]["changes"][0]["value"]["contacts"][0].delete("wa_id")
        bsuid_only_payload["entry"][0]["changes"][0]["value"]["contacts"][0]["user_id"] = "US.1349120865530274"
        bsuid_only_payload["entry"][0]["changes"][0]["value"]["messages"][0].delete("from")
        bsuid_only_payload["entry"][0]["changes"][0]["value"]["messages"][0]["from_user_id"] = "US.1349120865530274"
        allow(request).to receive(:raw_post).and_return(bsuid_only_payload.to_json)

        expect {
          service.process(request)
        }.to change(ExternalUser, :count).by(1)

        external_user = ExternalUser.last
        expect(external_user.external_id).to eq("US.1349120865530274")
        expect(external_user.display_name).to eq("John Doe")
      end
    end

    context "when message is a reply to another message" do
      let!(:external_user) { create(:external_user, hub: integration.hub, platform: "whatsapp", external_id: "1111111111") }
      let!(:conversation) { create(:conversation, hub: integration.hub, platform: "whatsapp", participant: external_user) }
      let!(:original_message) { create(:message, :outgoing, conversation: conversation, external_id: "original_msg_456") }

      it "stores replied_to_message_id in metadata when replying to an existing message" do
        reply_payload = {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {"phone_number_id" => phone_number_id},
                "contacts" => [{"wa_id" => "1111111111", "profile" => {"name" => "John Doe"}}],
                "messages" => [{
                  "id" => "reply_msg_789",
                  "type" => "text",
                  "text" => {"body" => "Replying to your message"},
                  "from" => "1111111111",
                  "context" => {"id" => "original_msg_456"}
                }]
              }
            }]
          }]
        }
        allow(request).to receive(:raw_post).and_return(reply_payload.to_json)

        service.process(request)

        reply = Message.incoming.last
        expect(reply.metadata["replied_to_message_id"]).to eq(original_message.id)
      end

      it "does not store replied_to_message_id when replied-to message is not found" do
        reply_payload = {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {"phone_number_id" => phone_number_id},
                "contacts" => [{"wa_id" => "1111111111", "profile" => {"name" => "John Doe"}}],
                "messages" => [{
                  "id" => "reply_msg_790",
                  "type" => "text",
                  "text" => {"body" => "Replying to unknown message"},
                  "from" => "1111111111",
                  "context" => {"id" => "nonexistent_msg_999"}
                }]
              }
            }]
          }]
        }
        allow(request).to receive(:raw_post).and_return(reply_payload.to_json)

        service.process(request)

        reply = Message.incoming.last
        expect(reply.metadata["replied_to_message_id"]).to be_nil
      end
    end

    context "when receiving unsupported message types" do
      it "creates an unsupported_message when receiving an image" do
        image_payload = payload.deep_dup
        image_payload["entry"][0]["changes"][0]["value"]["messages"][0].delete("text")
        image_payload["entry"][0]["changes"][0]["value"]["messages"][0]["type"] = "image"
        image_payload["entry"][0]["changes"][0]["value"]["messages"][0]["image"] = {
          "mime_type" => "image/jpeg",
          "sha256" => "abc123",
          "id" => "img_456"
        }
        allow(request).to receive(:raw_post).and_return(image_payload.to_json)

        expect {
          service.process(request)
        }.to change(ExternalUser, :count).by(1)
          .and change(Conversation, :count).by(1)
          .and change(Message, :count).by(1)

        message = Message.last
        expect(message.state).to eq("unsupported_message")
        expect(message.direction).to eq("outgoing")
        expect(message.status).to eq("sent")
        expect(message.body).to eq(I18n.t(:error_message_type_unsupported))
      end

      it "creates an unsupported_message when receiving a video" do
        video_payload = payload.deep_dup
        video_payload["entry"][0]["changes"][0]["value"]["messages"][0].delete("text")
        video_payload["entry"][0]["changes"][0]["value"]["messages"][0]["type"] = "video"
        video_payload["entry"][0]["changes"][0]["value"]["messages"][0]["video"] = {
          "mime_type" => "video/mp4",
          "sha256" => "def456",
          "id" => "vid_789"
        }
        allow(request).to receive(:raw_post).and_return(video_payload.to_json)

        expect {
          service.process(request)
        }.to change(ExternalUser, :count).by(1)
          .and change(Conversation, :count).by(1)
          .and change(Message, :count).by(1)

        message = Message.last
        expect(message.state).to eq("unsupported_message")
        expect(message.direction).to eq("outgoing")
        expect(message.status).to eq("sent")
        expect(message.body).to eq(I18n.t(:error_message_type_unsupported))
      end
    end

    context "when receiving button replies" do
      let(:document) { create(:document, source: create(:source, hub: integration.hub, source_type: :rss_feed)) }
      let(:source_message) { create(:message, :outgoing, conversation: Conversation.last, metadata: {answerable: true, document_ids_cited: [Base64.encode64("Document/#{document.id}")]}) }
      let(:button_payload) do
        {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {
                  "phone_number_id" => phone_number_id
                },
                "contacts" => [{
                  "wa_id" => "1111111111",
                  "profile" => {"name" => "John Doe"}
                }],
                "messages" => [{
                  "id" => "button_msg_123",
                  "type" => "interactive",
                  "interactive" => {
                    "type" => "button_reply",
                    "button_reply" => {
                      "id" => "see_sources_#{source_message&.id}",
                      "title" => "See Sources"
                    }
                  },
                  "from" => "1111111111"
                }]
              }
            }]
          }]
        }
      end

      before do
        # Create source message first
        service.process(request) # Create user, conversation, and first message
        source_message # Trigger let
      end

      it "validates button reply payload" do
        expect(service.valid_payload?(button_payload)).to be(true)
      end

      it "creates sources message when button is clicked" do
        allow(request).to receive(:raw_post).and_return(button_payload.to_json)

        expect {
          service.process(request)
        }.to change(Message, :count).by(1)

        sources_message = Message.last
        expect(sources_message.direction).to eq("outgoing")
        expect(sources_message.external_id).to start_with("sources_for_#{source_message.id}")
      end

      it "creates error message when source message is not found" do
        button_payload_invalid = button_payload.deep_dup
        button_payload_invalid["entry"][0]["changes"][0]["value"]["messages"][0]["interactive"]["button_reply"]["id"] = "see_sources_99999"
        allow(request).to receive(:raw_post).and_return(button_payload_invalid.to_json)

        expect {
          service.process(request)
        }.to change(Message, :count).by(1)

        error_message = Message.last
        expect(error_message.body).to eq(I18n.t(:message_sources_not_available))
      end

      it "creates error message when source message has no public source documents" do
        source_message.update!(metadata: {answerable: true})
        source_message.message_data_source_items.destroy_all
        allow(request).to receive(:raw_post).and_return(button_payload.to_json)

        expect {
          service.process(request)
        }.to change(Message, :count).by(1)

        error_message = Message.last
        expect(error_message.body).to eq(I18n.t(:message_sources_not_available))
      end
    end

    context "when receiving a template quick-reply button" do
      let(:document) { create(:document, source: create(:source, hub: integration.hub, source_type: :rss_feed)) }
      let(:source_message) { create(:message, :outgoing, conversation: Conversation.last, metadata: {answerable: true, document_ids_cited: [Base64.encode64("Document/#{document.id}")]}) }
      let(:template_button_payload) do
        {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {"phone_number_id" => phone_number_id},
                "contacts" => [{"wa_id" => "1111111111", "profile" => {"name" => "John Doe"}}],
                "messages" => [{
                  "id" => "tmpl_btn_1",
                  "type" => "button",
                  "button" => {"payload" => "see_sources_#{source_message&.id}", "text" => "See More"},
                  "from" => "1111111111"
                }]
              }
            }]
          }]
        }
      end

      before do
        service.process(request) # create user, conversation, and first message
        source_message # trigger let
      end

      it "validates the template button payload" do
        expect(service.valid_payload?(template_button_payload)).to be(true)
      end

      it "creates a sources message when the template button is tapped" do
        allow(request).to receive(:raw_post).and_return(template_button_payload.to_json)

        expect {
          service.process(request)
        }.to change(Message, :count).by(1)

        sources_message = Message.last
        expect(sources_message.direction).to eq("outgoing")
        expect(sources_message.external_id).to start_with("sources_for_#{source_message.id}")
      end
    end

    context "when receiving a reaction" do
      let(:reaction_payload) do
        {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {
                  "phone_number_id" => phone_number_id
                },
                "contacts" => [{
                  "wa_id" => "1111111111",
                  "profile" => {"name" => "John Doe"}
                }],
                "messages" => [{
                  "id" => "reaction_msg_123",
                  "type" => "reaction",
                  "from" => "1111111111",
                  "reaction" => {
                    "message_id" => "original_msg_456",
                    "emoji" => "\u{1F44D}"
                  }
                }]
              }
            }]
          }]
        }
      end

      before do
        allow(request).to receive(:raw_post).and_return(reaction_payload.to_json)
      end

      it "logs the reaction and does not create any records" do
        expect(LogService).to receive(:log)

        expect {
          service.process(request)
        }.not_to change(Message, :count)
      end
    end

    context "when receiving delivery 'delivered' status webhooks" do
      let(:outgoing_message) { create(:message, :outgoing, external_id: "wamid.XXXX") }
      let(:delivery_delivered_payload) do
        {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {
                  "phone_number_id" => phone_number_id
                },
                "statuses" => [{
                  "id" => outgoing_message.external_id,
                  "status" => "delivered",
                  "timestamp" => Time.now.to_i.to_s,
                  "recipient_id" => "1111111111"
                }]
              }
            }]
          }]
        }
      end

      before do
        outgoing_message
        allow(request).to receive(:raw_post).and_return(delivery_delivered_payload.to_json)
      end

      it "hands off the delivered status" do
        expect(service).to receive(:process_delivery_status_change).with(outgoing_message.external_id, "delivered", nil)

        service.process(request)
      end

      it "does not create new messages" do
        expect {
          service.process(request)
        }.not_to change(Message, :count)
      end
    end

    context "when receiving delivery failure status webhooks" do
      let(:outgoing_message) { create(:message, :outgoing, external_id: "wamid.XXXX") }
      let(:delivery_failure_payload) do
        {
          "object" => "whatsapp_business_account",
          "entry" => [{
            "changes" => [{
              "field" => "messages",
              "value" => {
                "metadata" => {
                  "phone_number_id" => phone_number_id
                },
                "statuses" => [{
                  "id" => outgoing_message.external_id,
                  "status" => "failed",
                  "timestamp" => Time.now.to_i.to_s,
                  "recipient_id" => "1111111111",
                  "errors" => [{"code" => 131026, "title" => "Message Undeliverable"}]
                }]
              }
            }]
          }]
        }
      end

      before do
        outgoing_message
        allow(request).to receive(:raw_post).and_return(delivery_failure_payload.to_json)
      end

      it "hands off the failed status with only the error code and message" do
        expect(service).to receive(:process_delivery_status_change).with(outgoing_message.external_id, "failed", {code: 131026, message: "Message Undeliverable"})

        service.process(request)
      end

      it "does not create new messages" do
        expect {
          service.process(request)
        }.not_to change(Message, :count)
      end

      it "ignores unsupported statuses" do
        payload = delivery_failure_payload.deep_dup
        payload["entry"][0]["changes"][0]["value"]["statuses"][0]["status"] = "unknown"
        allow(request).to receive(:raw_post).and_return(payload.to_json)

        expect(service).not_to receive(:process_delivery_status_change)
        service.process(request)
      end
    end
  end
end

# Separate describe block so `use_transactional_tests = false` gives each thread its own DB connection,
# allowing race conditions to manifest.
RSpec.describe "WhatsApp Webhook - Concurrent First Messages", type: :service do
  self.use_transactional_tests = false

  after { DatabaseCleaner.clean_with(:truncation) }

  let(:app_secret) { "test_app_secret" }
  let(:verify_token) { "test_verify_token" }
  let(:phone_number_id) { "1234567890" }

  def build_payload(message_id:)
    {
      "object" => "whatsapp_business_account",
      "entry" => [{
        "changes" => [{
          "field" => "messages",
          "value" => {
            "metadata" => {"phone_number_id" => phone_number_id},
            "contacts" => [{
              "wa_id" => "9999999999",
              "profile" => {"name" => "Race Condition User"}
            }],
            "messages" => [{
              "id" => message_id,
              "type" => "text",
              "text" => {"body" => "Message #{message_id}"},
              "from" => "9999999999"
            }]
          }
        }]
      }]
    }
  end

  def build_request(payload)
    instance_double(ActionDispatch::Request, raw_post: payload.to_json)
  end

  it "creates exactly one ExternalUser when two messages arrive simultaneously" do
    create(:whatsapp_messaging_integration, credentials: {phone_number_id: phone_number_id}, active: true)

    threads = 2.times.map do |i|
      Thread.new do
        service = WebhookServices::WhatsappService.new(app_secret, verify_token)
        service.process(build_request(build_payload(message_id: "msg_#{i}")))
      end
    end
    threads.each(&:join)

    expect(ExternalUser.where(external_id: "9999999999").count).to eq(1)
  end

  it "creates exactly one Conversation when two messages arrive simultaneously" do
    integration = create(:whatsapp_messaging_integration, credentials: {phone_number_id: phone_number_id}, active: true)
    create(:external_user, hub: integration.hub, platform: "whatsapp", external_id: "9999999999", display_name: "Race Condition User")

    # Simulate the race: first call creates normally, second call raises as if
    # another thread just inserted, then the rescue does find_by! to recover.
    # Sequential execution ensures the first conversation is committed before
    # the second call's find_by! looks for it.
    original_method = Conversation.method(:find_or_create_by)
    call_count = 0
    allow(Conversation).to receive(:find_or_create_by) do |**attrs, &block|
      call_count += 1
      if call_count == 1
        original_method.call(**attrs, &block)
      else
        raise ActiveRecord::RecordNotUnique
      end
    end

    2.times do |i|
      service = WebhookServices::WhatsappService.new(app_secret, verify_token)
      service.process(build_request(build_payload(message_id: "msg_#{i}")))
    end

    expect(Conversation.count).to eq(1)
    expect(Conversation.first.messages.incoming.count).to eq(2)
  end
end
