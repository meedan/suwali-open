require "rails_helper"

RSpec.describe ContributionHandler, type: :service do
  let(:hub) { create(:hub) }
  let(:trusted_external_user) { create(:external_user, hub: hub, trusted_user: true, external_id: 1) }
  let(:untrusted_external_user) { create(:external_user, hub: hub, trusted_user: false, external_id: 2) }
  let(:internal_user) { create(:user) }

  describe "#initialize" do
    let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp") }
    let(:message) { create(:message, conversation: conversation, direction: :incoming, body: "test") }
    let(:handler) { ContributionHandler.new(message) }

    it "sets the message" do
      expect(handler.instance_variable_get(:@message)).to eq(message)
    end

    it "sets the conversation from message" do
      expect(handler.instance_variable_get(:@conversation)).to eq(conversation)
    end

    it "sets the hub from conversation" do
      expect(handler.instance_variable_get(:@hub)).to eq(hub)
    end
  end

  describe "#process" do
    context "with outgoing message" do
      let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp") }
      let(:message) { create(:message, conversation: conversation, direction: :outgoing, body: "test") }
      let(:handler) { ContributionHandler.new(message) }

      it "returns false and does not process" do
        expect(handler.process).to be false
      end
    end

    context "with incoming message containing contribution code" do
      let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp", state: "normal") }

      context "from trusted external user" do
        it "changes conversation state and message state" do
          message = create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
          expect(conversation.reload.state).to eq("awaiting_contribution")
          expect(message.reload.state).to eq("user_contribution_started")
        end

        it "creates a response message with contribution prompt" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
          }.to change { conversation.messages.where(state: "bot_contribution_started").count }.by(1)
        end

        it "matches the code regardless of capitalization" do
          hub.update!(contribution_code: "#MyHub2026")
          message = create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #myhub2026")
          expect(conversation.reload.state).to eq("awaiting_contribution")
          expect(message.reload.state).to eq("user_contribution_started")
        end
      end

      context "from untrusted external user" do
        let(:conversation) { create(:conversation, hub: hub, participant: untrusted_external_user, platform: "whatsapp", state: "normal") }

        it "does not change conversation state" do
          message = create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
          expect(conversation.reload.state).to eq("normal")
          expect(message.reload.state).to eq("user_message")
        end

        it "does not create a response message" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
          }.to_not change { conversation.messages.where(state: "bot_contribution_started").count }
        end

        context "when the hub accepts contributions from all end-users" do
          let(:hub) { create(:hub, contribution_audience: :all_end_users) }

          it "changes conversation state and message state" do
            message = create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
            expect(conversation.reload.state).to eq("awaiting_contribution")
            expect(message.reload.state).to eq("user_contribution_started")
          end
        end
      end

      context "from internal user" do
        let(:conversation) { create(:conversation, hub: hub, participant: internal_user, platform: "internal", state: "normal") }

        it "changes conversation state to awaiting_contribution" do
          message = create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
          expect(conversation.reload.state).to eq("awaiting_contribution")
          expect(message.reload.state).to eq("user_contribution_started")
        end
      end
    end

    context "with incoming message without contribution code" do
      let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp", state: "normal") }

      it "does not change conversation state" do
        message = create(:message, conversation: conversation, direction: :incoming, body: "Just a normal message")
        expect(conversation.reload.state).to eq("normal")
        expect(message.reload.state).to eq("user_message")
      end
    end

    context "when conversation is awaiting contribution" do
      let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp", state: "awaiting_contribution") }

      # Cancelling is now done via the "Cancel" button on the prompt (see the base webhook service
      # spec), not by typing a word — so any typed reply while awaiting is treated as a submission,
      # including the word "cancel".
      context "with a typed reply (including the word 'cancel')" do
        it "treats it as a submission, not a cancellation" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "  Cancel  ")
          }.to change { Contribution.count }.by(1)

          expect(conversation.messages.outgoing.last.state).to eq("bot_contribution_submitted")
        end
      end

      context "with contribution content" do
        it "resets conversation state to normal" do
          create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          expect(conversation.reload.state).to eq("normal")
        end

        it "updates message state to user_contribution_submitted" do
          message = create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          expect(message.reload.state).to eq("user_contribution_submitted")
        end

        it "creates a contribution" do
          message = nil
          expect {
            message = create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          }.to change { Contribution.count }.by(1)

          contribution = Contribution.last
          expect(contribution.message).to eq(message)
          expect(contribution.hub).to eq(hub)
          expect(contribution.content).to eq("This is my contribution content")
        end

        it "creates a thank you response message" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          }.to change { conversation.messages.outgoing.count }.by(1)

          response = conversation.messages.outgoing.last
          expect(response.body).to eq(I18n.t(:contribution_thanks))
          expect(response.state).to eq("bot_contribution_submitted")
        end

        context "with contribution content containing contribution code" do
          it "creates the contribution normally" do
            expect {
              create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content #{hub.contribution_code}")
            }.to change { Contribution.count }.by(1)
          end
        end
      end

      context "with internal conversation" do
        let(:conversation) { create(:conversation, hub: hub, participant: internal_user, platform: "internal", state: "awaiting_contribution") }

        it "does not create a contribution for internal platform" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          }.not_to change { Contribution.count }
        end

        it "still resets conversation state to normal" do
          create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          expect(conversation.reload.state).to eq("normal")
        end

        it "still creates a thank you response message" do
          expect {
            create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
          }.to change { conversation.messages.outgoing.count }.by(1)
        end
      end
    end

    context "when hub has no contribution code" do
      let(:hub_without_code) { create(:hub, contribution_code: nil) }
      let(:conversation) { create(:conversation, hub: hub_without_code, participant: trusted_external_user, platform: "whatsapp", state: "normal") }
      let(:message) { create(:message, conversation: conversation, direction: :incoming, body: "#contrib123") }
      let(:handler) { ContributionHandler.new(message) }

      it "returns false" do
        expect(handler.process).to be false
      end

      it "does not initiate contribution flow" do
        handler.process
        expect(conversation.reload.state).to eq("normal")
      end
    end
  end

  describe "localization" do
    let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp", state: "normal", language: "pt") }

    it "uses the conversation language for contribution prompt" do
      create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #{hub.contribution_code}")
      response = conversation.messages.where(state: "bot_contribution_started").last
      expect(response.body).to eq(I18n.t(:contribution_prompt, locale: :pt))
    end

    it "uses the conversation language for contribution thanks" do
      conversation.update!(state: "awaiting_contribution")
      create(:message, conversation: conversation, direction: :incoming, body: "This is my contribution content")
      response = conversation.messages.where(state: "bot_contribution_submitted").last
      expect(response.body).to eq(I18n.t(:contribution_thanks, locale: :pt))
    end
  end

  describe "thread safety with pessimistic locking" do
    let(:conversation) { create(:conversation, hub: hub, participant: trusted_external_user, platform: "whatsapp", state: "normal") }
    let(:message1) { create(:message, conversation: conversation, direction: :incoming, body: "I want to contribute #contrib123") }
    let(:message2) { create(:message, conversation: conversation, direction: :incoming, body: "Another message") }

    it "processes messages sequentially with lock" do
      handler1 = ContributionHandler.new(message1)
      handler2 = ContributionHandler.new(message2)

      expect(conversation).to receive(:with_lock).twice.and_call_original

      handler1.process
      handler2.process
    end
  end
end
