require "rails_helper"

RSpec.describe NotebookItem, type: :model do
  it "is valid with valid attributes" do
    item = build(:notebook_item)
    expect(item).to be_valid
  end

  describe "summary generation callbacks" do
    let(:notebook) { create(:notebook) }
    let(:message) { create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub)) }
    let(:note) { create(:note, notebook: create(:notebook, hub: notebook.hub)) }

    describe "on create" do
      it "enqueues ItemSummaryWorker for non-Note items" do
        expect(ItemSummaryWorker).to receive(:perform_async).with("Message", message.id, notebook.id)

        create(:notebook_item, notebook: notebook, item: message)
      end

      it "stamps ai_summary_update_requested_at synchronously" do
        create(:notebook_item, notebook: notebook, item: message)

        expect(notebook.reload.ai_summary_update_requested_at).to be_within(1.second).of(Time.now.utc)
      end

      it "enqueues ItemSummaryWorker for Note items" do
        expect(ItemSummaryWorker).to receive(:perform_async).with("Note", note.id, notebook.id)

        create(:notebook_item, notebook: notebook, item: note)
      end
    end

    describe "on destroy" do
      it "enqueues NotebookSummaryWorker when item is removed" do
        notebook_item = create(:notebook_item, notebook: notebook, item: message)

        expect(NotebookSummaryWorker).to receive(:perform_async).with(notebook.id, anything)

        notebook_item.destroy
      end

      it "updates ai_summary_update_requested_at timestamp" do
        notebook_item = create(:notebook_item, notebook: notebook, item: message)

        notebook_item.destroy
        notebook.reload

        expect(notebook.ai_summary_update_requested_at).to be_within(1.second).of(Time.now.utc)
      end
    end
  end

  describe "uniqueness validation" do
    it "prevents duplicate items in same notebook" do
      notebook = create(:notebook)
      message = create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub))

      create(:notebook_item, notebook: notebook, item: message)

      duplicate = build(:notebook_item, notebook: notebook, item: message)
      expect(duplicate).not_to be_valid
    end

    it "allows same item in different notebooks" do
      notebook_a = create(:notebook)
      notebook_b = create(:notebook, hub: notebook_a.hub)
      message = create(:message, :outgoing, conversation: create(:conversation, hub: notebook_a.hub))

      create(:notebook_item, notebook: notebook_a, item: message)
      duplicate_in_b = build(:notebook_item, notebook: notebook_b, item: message)

      expect(duplicate_in_b).to be_valid
    end
  end

  describe "self-referencing validation" do
    it "prevents adding a notebook to itself" do
      notebook = create(:notebook)
      item = build(:notebook_item, notebook: notebook, item: notebook)
      expect(item).not_to be_valid
      expect(item.errors[:base]).to include(I18n.t(:error_notebook_cannot_contain_itself))
    end

    it "allows adding a notebook to a different notebook" do
      notebook_a = create(:notebook)
      notebook_b = create(:notebook, hub: notebook_a.hub)
      item = build(:notebook_item, notebook: notebook_a, item: notebook_b)
      expect(item).to be_valid
    end
  end

  describe "same hub validation" do
    it "rejects an item from another hub" do
      notebook = create(:notebook)
      other_hub_document = create(:document)
      item = build(:notebook_item, notebook: notebook, item: other_hub_document)
      expect(item).not_to be_valid
      expect(item.errors[:base]).to include(I18n.t(:error_notebook_item_different_hub))
    end
  end

  describe "items limit validation" do
    it "prevents adding an item when notebook has reached the max" do
      ENV["MAX_NOTEBOOK_ITEMS"] = "2"
      notebook = create(:notebook)
      allow(notebook).to receive(:notebook_items).and_return(double(count: 2))

      item = build(:notebook_item, notebook: notebook, item: create(:message, :outgoing))
      expect(item).not_to be_valid
      expect(item.errors[:base]).to include(I18n.t(:error_notebook_items_limit_reached, max: ENV.fetch("MAX_NOTEBOOK_ITEMS").to_i))
    ensure
      ENV.delete("MAX_NOTEBOOK_ITEMS")
    end

    it "allows adding an item when notebook is below the max" do
      ENV["MAX_NOTEBOOK_ITEMS"] = "3"
      notebook = create(:notebook)
      allow(notebook).to receive(:notebook_items).and_return(double(count: 2))

      item = build(:notebook_item, notebook: notebook, item: create(:message, :outgoing, conversation: create(:conversation, hub: notebook.hub)))
      expect(item).to be_valid
    ensure
      ENV.delete("MAX_NOTEBOOK_ITEMS")
    end
  end

  describe "trial restrictions" do
    it "allows creating notebook item on premium hub" do
      hub = create(:hub, plan: :enterprise)
      notebook = create(:notebook, hub: hub)
      message = create(:message, :outgoing, conversation: create(:conversation, hub: hub))
      item = build(:notebook_item, notebook: notebook, item: message)
      expect(item).to be_valid
    end

    it "allows creating notebook item on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      message = create(:message, :outgoing, conversation: create(:conversation, hub: hub))
      item = build(:notebook_item, notebook: notebook, item: message)
      expect(item).to be_valid
    end

    it "rejects creating notebook item on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      conversation = create(:conversation, hub: hub)
      message = create(:message, :outgoing, conversation: conversation)
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)
      item = build(:notebook_item, notebook: notebook, item: message)
      expect(item).not_to be_valid
      expect(item.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "rejects creating notebook item on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      conversation = create(:conversation, hub: hub)
      message = create(:message, :outgoing, conversation: conversation)
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)
      item = build(:notebook_item, notebook: notebook, item: message)
      expect(item).not_to be_valid
      expect(item.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end

  describe ".visible" do
    def item_for(notebook, item)
      create(:notebook_item, notebook: notebook, item: item)
    end

    it "hides a conversation item once the conversation is soft-deleted" do
      notebook = create(:notebook)
      conversation = create(:conversation, hub: notebook.hub)
      conversation_item = item_for(notebook, conversation)
      conversation.update!(deleted_at: Time.current)

      expect(notebook.notebook_items.visible).not_to include(conversation_item)
    end

    it "hides a message item once its conversation is soft-deleted" do
      notebook = create(:notebook)
      conversation = create(:conversation, hub: notebook.hub)
      message_item = item_for(notebook, create(:message, :incoming, conversation: conversation))
      conversation.update!(deleted_at: Time.current)

      expect(notebook.notebook_items.visible).not_to include(message_item)
    end

    it "hides a cluster item once every message of the cluster is in a soft-deleted conversation" do
      notebook = create(:notebook)
      conversation = create(:conversation, hub: notebook.hub)
      cluster = create(:message_cluster, hub: notebook.hub)
      create(:message, :incoming, conversation: conversation, message_cluster: cluster)
      cluster_item = item_for(notebook, cluster)
      conversation.update!(deleted_at: Time.current)

      expect(notebook.notebook_items.visible).not_to include(cluster_item)
    end

    it "keeps a cluster item while one of its messages is in a live conversation" do
      notebook = create(:notebook)
      live = create(:conversation, hub: notebook.hub)
      deleted = create(:conversation, hub: notebook.hub)
      cluster = create(:message_cluster, hub: notebook.hub)
      create(:message, :incoming, conversation: live, message_cluster: cluster)
      create(:message, :incoming, conversation: deleted, message_cluster: cluster)
      cluster_item = item_for(notebook, cluster)
      deleted.update!(deleted_at: Time.current)

      expect(notebook.notebook_items.visible).to include(cluster_item)
    end

    it "keeps items of other types" do
      notebook = create(:notebook)
      document_item = item_for(notebook, create(:document, source: create(:source, hub: notebook.hub)))
      nested_notebook_item = item_for(notebook, create(:notebook, hub: notebook.hub))

      expect(notebook.notebook_items.visible).to contain_exactly(document_item, nested_notebook_item)
    end
  end
end
