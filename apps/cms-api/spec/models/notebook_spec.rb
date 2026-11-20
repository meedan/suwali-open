require "rails_helper"

RSpec.describe Notebook, type: :model do
  it "is valid with valid attributes" do
    notebook = build(:notebook)
    expect(notebook).to be_valid
  end

  it "is invalid without a name" do
    notebook = build(:notebook, name: nil)
    expect(notebook).not_to be_valid
  end

  it "can be published if summary is not blank" do
    notebook = create(:notebook, summary: "Present")
    expect(notebook.published).to eq(false)
    expect(notebook.published_at).to be_nil
    expect(notebook.publish).to eq(true)
    expect(notebook.reload.published).to eq(true)
    expect(notebook.reload.published_at).not_to be_nil
  end

  it "can be unpublished" do
    notebook = create(:notebook, summary: "Present", published: true)
    notebook.unpublish
    expect(notebook.reload.published).to eq(false)
  end

  it "can't be published if summary is blank" do
    notebook = create(:notebook, summary: "")
    expect(notebook.published).to eq(false)
    expect(notebook.publish).to eq(false)
    expect(notebook.reload.published).to eq(false)
  end

  it "belongs to a hub" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    expect(notebook.hub).to eq(hub)
  end

  it "includes its topics in as_json" do
    notebook = create(:notebook)
    topic_item = notebook.topic_items.create!(topic: notebook.hub.topics.create!(name: "Climate"))

    expect(notebook.as_json[:topics].map(&:as_json)).to eq([{id: topic_item.id, topic_id: topic_item.topic_id, name: "Climate"}])
  end

  it "has conversation items" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    item = create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email))
    notebook.conversations << item
    expect(notebook.reload.items.map(&:item)).to eq([item])
  end

  it "has message items" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    conversation = create(:conversation, hub: hub, participant: create(:user, email: Faker::Internet.email))
    item = create(:message, :outgoing, conversation: conversation)
    notebook.messages << item
    expect(notebook.reload.items.map(&:item)).to eq([item])
  end

  it "has document items" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    item = create(:document, source: create(:source, hub: hub))
    notebook.documents << item
    expect(notebook.reload.items.map(&:item)).to eq([item])
  end

  it "has message-cluster items" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    item = create(:message_cluster, hub: hub)
    notebook.message_clusters << item
    expect(notebook.reload.items.map(&:item)).to eq([item])
  end

  it "has child notebook items" do
    hub = create(:hub)
    notebook = create(:notebook, hub: hub)
    child = create(:notebook, hub: hub)
    create(:notebook_item, notebook: notebook, item: child)
    expect(notebook.reload.child_notebooks).to eq([child])
  end

  describe "#text_for_summarization" do
    it "returns summary when present" do
      notebook = build(:notebook, summary: "My summary", ai_summary: "AI summary")
      expect(notebook.text_for_summarization).to eq("My summary")
    end

    it "falls back to ai_summary when summary is blank" do
      notebook = build(:notebook, summary: "", ai_summary: "AI summary")
      expect(notebook.text_for_summarization).to eq("AI summary")
    end

    it "returns nil when both are blank" do
      notebook = build(:notebook, summary: "", ai_summary: nil)
      expect(notebook.text_for_summarization).to be_nil
    end
  end

  describe "#effective_summary" do
    it "prefers the summary written by a user over the AI summary" do
      expect(build(:notebook, summary: "User summary", ai_summary: "AI summary").effective_summary).to eq("User summary")
    end

    it "falls back to the AI summary" do
      expect(build(:notebook, summary: "", ai_summary: "AI summary").effective_summary).to eq("AI summary")
    end
  end

  describe "#summarizable?" do
    it "is true when ai_summary is present" do
      notebook = build(:notebook, summary: "", ai_summary: "AI summary")
      expect(notebook.summarizable?).to be(true)
    end

    it "is true when text_for_summarization is present" do
      notebook = build(:notebook, summary: "My summary", ai_summary: nil)
      expect(notebook.summarizable?).to be(true)
    end

    it "is false when both ai_summary and text_for_summarization are blank" do
      notebook = build(:notebook, summary: "", ai_summary: nil)
      expect(notebook.summarizable?).to be(false)
    end
  end

  describe "#all_items_summarizable?" do
    it "is true when every item has text to summarize" do
      notebook = create(:notebook)
      create(:notebook_item, notebook: notebook, item: create(:message, :outgoing, body: "Some text", conversation: create(:conversation, hub: notebook.hub)))
      create(:notebook_item, notebook: notebook, item: create(:document, content: "Some text", source: create(:source, hub: notebook.hub)))

      expect(notebook.all_items_summarizable?).to be(true)
    end

    it "is false when an item has no text to summarize" do
      notebook = create(:notebook)
      create(:notebook_item, notebook: notebook, item: create(:message, :outgoing, body: "Some text", conversation: create(:conversation, hub: notebook.hub)))
      create(:notebook_item, notebook: notebook, item: create(:document, content: nil, source: create(:source, hub: notebook.hub)))

      expect(notebook.all_items_summarizable?).to be(false)
    end

    it "ignores items from a soft-deleted conversation" do
      notebook = create(:notebook)
      create(:notebook_item, notebook: notebook, item: create(:message, :outgoing, body: "Some text", conversation: create(:conversation, hub: notebook.hub)))
      empty_conversation = create(:conversation, hub: notebook.hub)
      create(:notebook_item, notebook: notebook, item: empty_conversation)
      empty_conversation.update!(deleted_at: Time.current)

      expect(notebook.all_items_summarizable?).to be(true)
    end

    it "is true for an item that already has an ai_summary but no text" do
      notebook = create(:notebook)
      document = create(:document, content: nil, source: create(:source, hub: notebook.hub))
      document.update_column(:ai_summary, "Existing summary")
      create(:notebook_item, notebook: notebook, item: document)

      expect(notebook.all_items_summarizable?).to be(true)
    end
  end

  it "renames existing name with counter" do
    hub = create(:hub)
    user = create(:user, email: Faker::Internet.email)
    notebook = create(:notebook, name: "Foo", hub: hub, user: user)
    expect(notebook.name).to eq("Foo")
    notebook = create(:notebook, name: "Foo", hub: hub, user: user)
    expect(notebook.name).to eq("Foo [1]")
    notebook = create(:notebook, name: "Foo", hub: hub, user: user)
    expect(notebook.name).to eq("Foo [2]")
    notebook = create(:notebook, name: "Foo", user: user)
    expect(notebook.name).to eq("Foo")
    notebook = create(:notebook, name: "Foo", hub: hub)
    expect(notebook.name).to eq("Foo")
    notebook = create(:notebook, name: "Foo")
    expect(notebook.name).to eq("Foo")
  end

  describe "summary validation when published" do
    it "prevents changing summary when notebook is already published" do
      notebook = create(:notebook, summary: "Original summary", published: true)
      notebook.summary = "Updated summary"
      expect(notebook).not_to be_valid
      expect(notebook.errors[:base][0]).to include("cannot be changed while notebook is published")
    end

    it "allows changing summary when notebook is not published" do
      notebook = create(:notebook, summary: "Original summary", published: false)
      notebook.summary = "Updated summary"
      expect(notebook).to be_valid
    end

    it "allows changing summary when publishing a notebook" do
      notebook = create(:notebook, summary: "Original summary", published: false)
      notebook.summary = "Updated summary"
      notebook.published = true
      expect(notebook).to be_valid
    end

    it "allows keeping the same summary when notebook is published" do
      notebook = create(:notebook, summary: "Original summary", published: true)
      notebook.name = "Updated name"
      expect(notebook).to be_valid
    end
  end

  describe "copy_ai_summary_to_summary callback" do
    it "copies ai_summary to summary when published notebook is updated with blank summary" do
      notebook = create(:notebook, summary: "Original summary", ai_summary: "AI generated summary", published: true)
      notebook.summary = ""
      notebook.valid?
      expect(notebook.summary).to eq("AI generated summary")
    end

    it "does not copy ai_summary when published notebook has non-blank summary" do
      notebook = create(:notebook, summary: "Original summary", ai_summary: "AI generated summary", published: true)
      notebook.name = "Updated name"
      notebook.valid?
      expect(notebook.summary).to eq("Original summary")
    end

    it "does not copy ai_summary when unpublished notebook is updated with blank summary" do
      notebook = create(:notebook, summary: "Original summary", ai_summary: "AI generated summary", published: false)
      notebook.summary = ""
      notebook.valid?
      expect(notebook.summary).to eq("")
    end

    it "copies ai_summary when publishing a notebook with blank summary" do
      notebook = create(:notebook, summary: "Original summary", ai_summary: "AI generated summary", published: false)
      notebook.summary = ""
      notebook.published = true
      notebook.valid?
      expect(notebook.summary).to eq("AI generated summary")
    end
  end

  describe "track_summary_updater callback" do
    it "sets summary_updated_at when summary is changed" do
      notebook = create(:notebook, summary: "Original summary")
      expect(notebook.summary_updated_at).not_to be_nil
      original_timestamp = notebook.summary_updated_at

      sleep 0.1
      notebook.update(summary: "Updated summary")
      expect(notebook.reload.summary_updated_at).to be > original_timestamp
    end

    it "sets last_summary_updated_by when summary_updater is provided" do
      user = create(:user, email: Faker::Internet.email)
      notebook = create(:notebook, summary: "Original summary")

      notebook.summary_updater = user
      notebook.summary = "Updated summary"
      notebook.save

      expect(notebook.reload.last_summary_updated_by).to eq(user)
    end

    it "does not change summary_updated_at when summary is not changed" do
      notebook = create(:notebook, summary: "Original summary")
      original_timestamp = notebook.summary_updated_at

      sleep 0.1
      notebook.update(name: "Updated name")
      expect(notebook.reload.summary_updated_at).to eq(original_timestamp)
    end

    it "should delete notebook with items" do
      hub = create(:hub)
      notebook = create(:notebook, hub: hub)
      item = create(:document, source: create(:source, hub: hub))
      create(:notebook_item, notebook: notebook, item: item)
      expect { notebook.destroy! }.to change(Notebook, :count).by(-1)
    end
  end

  it_behaves_like "knowledge_service_syncable" do
    let(:ingestible_attributes) { {published: true} }
  end

  describe "#sync_topics_to_knowledge_service" do
    it "does not enqueue a topics sync when the notebook is unpublished" do
      notebook = create(:notebook, published: false)
      notebook.update_columns(sync_status: :complete)

      expect { notebook.sync_topics_to_knowledge_service }.not_to change { KnowledgeServiceWorker.jobs.size }
    end
  end

  describe "deletion behavior" do
    it "automatically unpublishes and deletes published notebook" do
      notebook = create(:notebook, summary: "Summary", published: true)
      expect(notebook).to receive(:remove_from_knowledge_service)
      expect { notebook.destroy! }.to change(Notebook, :count).by(-1)
    end

    it "allows deleting unpublished notebook" do
      notebook = create(:notebook, published: false)
      expect { notebook.destroy! }.to change(Notebook, :count).by(-1)
    end
  end

  describe "sync_status and publication" do
    it "sets sync_status to pending when publishing a notebook" do
      notebook = create(:notebook, summary: "Summary", published: false)
      notebook.update(published: true)
      expect(notebook.reload.sync_status).to eq("pending")
    end

    it "sets sync_status to pending when unpublishing a notebook" do
      notebook = create(:notebook, summary: "Summary", published: true)
      notebook.update(published: false)
      expect(notebook.reload.sync_status).to eq("pending")
    end
  end

  describe "trial restrictions" do
    it "allows creating notebook on premium hub" do
      hub = create(:hub, plan: :enterprise)
      notebook = build(:notebook, hub: hub)
      expect(notebook).to be_valid
    end

    it "allows creating notebook on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      notebook = build(:notebook, hub: hub)
      expect(notebook).to be_valid
    end

    it "rejects creating notebook on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      notebook = build(:notebook, hub: hub)
      expect(notebook).not_to be_valid
      expect(notebook.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "rejects creating notebook on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.ago)
      notebook = build(:notebook, hub: hub)
      expect(notebook).not_to be_valid
      expect(notebook.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end

  it "returns data_source_payload" do
    notebook = create(:notebook)

    expect(notebook.data_source_payload).to include({
      updated_at: notebook.updated_at,
      active: notebook.active,
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

  it "includes priority_tier in data_source_payload" do
    notebook = create(:notebook, priority_tier: 2)
    expect(notebook.data_source_payload).to include(priority_tier: 2)
  end

  describe ".ordered_by_last_editor_name" do
    let(:hub) { create(:hub) }

    def edited_by(editor)
      create(:notebook, hub: hub, last_summary_updated_by: editor)
    end

    it "orders by the last editor's name, falling back to email, with unedited notebooks last" do
      zed = edited_by(create(:user, name: "Zed", email: "zed@example.com"))
      unedited = edited_by(nil)
      amy = edited_by(create(:user, name: "amy", email: "amy@example.com"))
      bea = edited_by(create(:user, name: "", email: "bea@example.com"))

      expect(hub.notebooks.ordered_by_last_editor_name("asc")).to eq([amy, bea, zed, unedited])
      expect(hub.notebooks.ordered_by_last_editor_name("desc")).to eq([zed, bea, amy, unedited])
    end
  end
end
