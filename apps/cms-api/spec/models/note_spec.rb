require "rails_helper"

RSpec.describe Note, type: :model do
  it "is valid with valid attributes" do
    note = build(:note)
    expect(note).to be_valid
  end

  it "is invalid without a title" do
    note = build(:note, title: nil)
    expect(note).not_to be_valid
  end

  it "is invalid without content" do
    note = build(:note, content: nil)
    expect(note).not_to be_valid
  end

  it "belongs to a notebook" do
    user = create(:user)
    notebook = create(:notebook, user: user)
    note = create(:note, notebook: notebook, user: user)
    expect(note.notebook).to eq(notebook)
  end

  it "updates notebook when note is updated" do
    user = create(:user)
    notebook = create(:notebook, user: user)
    updated_at = notebook.updated_at
    create(:note, notebook: notebook, user: user)
    expect(notebook.reload.updated_at).to be > updated_at
  end

  it "creates NotebookItem when note is created and deletes it when note is deleted" do
    note = nil
    expect {
      note = create(:note)
    }.to change(NotebookItem, :count).by(1)
    expect {
      note.destroy!
    }.to change(NotebookItem, :count).by(-1)
  end

  it "renames existing title with counter" do
    hub = create(:hub)
    user = create(:user, email: Faker::Internet.email)
    notebook = create(:notebook, hub: hub)
    note = create(:note, notebook: notebook, title: "Foo", user: user)
    expect(note.title).to eq("Foo")
    note = create(:note, notebook: notebook, title: "Foo", user: user)
    expect(note.title).to eq("Foo [1]")
    note = create(:note, notebook: notebook, title: "Foo", user: user)
    expect(note.title).to eq("Foo [2]")
    note = create(:note, title: "Foo", user: user)
    expect(note.title).to eq("Foo")
    note = create(:note, title: "Foo", notebook: notebook)
    expect(note.title).to eq("Foo")
    note = create(:note, title: "Foo")
    expect(note.title).to eq("Foo")
  end

  describe "#text_for_summarization" do
    it "returns the note content" do
      note = create(:note, title: "My Title", content: "My note content")
      expect(note.text_for_summarization).to eq("My note content")
    end
  end

  describe "summary generation callbacks" do
    it "enqueues ItemSummaryWorker when content is updated" do
      note = create(:note, content: "Original content")

      expect(ItemSummaryWorker).to receive(:perform_async).with("Note", note.id, note.notebook_id)

      note.update(content: "Updated content")
    end

    it "does not enqueue ItemSummaryWorker when only title is updated" do
      note = create(:note, title: "Original title", content: "Content")

      expect(ItemSummaryWorker).not_to receive(:perform_async)

      note.update(title: "New title")
    end

    it "clears ai_summary when content is updated" do
      note = create(:note, content: "Original content", ai_summary: "Old summary")

      note.update(content: "Updated content")
      note.reload

      expect(note.ai_summary).to be_nil
    end
  end

  describe "trial restrictions" do
    it "allows creating note on premium hub" do
      hub = create(:hub, plan: :enterprise)
      notebook = create(:notebook, hub: hub)
      note = build(:note, notebook: notebook)
      expect(note).to be_valid
    end

    it "allows creating note on free hub with active trial" do
      hub = create(:hub, plan: :free, trial_started_at: 1.day.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      note = build(:note, notebook: notebook)
      expect(note).to be_valid
    end

    it "rejects creating note on free hub with expired trial" do
      hub = create(:hub, plan: :free, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)
      note = build(:note, notebook: notebook)
      expect(note).not_to be_valid
      expect(note.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end

    it "rejects creating note on free_unrestricted hub with expired trial" do
      hub = create(:hub, plan: :free_unrestricted, trial_started_at: 2.days.ago, trial_ends_at: 1.day.from_now)
      notebook = create(:notebook, hub: hub)
      # Expire the trial
      hub.update_columns(trial_ends_at: 1.day.ago)
      note = build(:note, notebook: notebook)
      expect(note).not_to be_valid
      expect(note.errors[:base]).to include(I18n.t(:error_plan_restriction_trial_expired))
    end
  end
end
