require "rails_helper"
require "rake"

RSpec.describe "backfill_user_topic_items" do
  before(:all) do
    Rails.application.load_tasks unless Rake::Task.task_defined?("backfill_user_topic_items")
  end

  after do
    Rake::Task["backfill_user_topic_items"].reenable
    ENV.delete("apply")
  end

  def run_task(apply: true)
    ENV["apply"] = "true" if apply
    Rake::Task["backfill_user_topic_items"].invoke
    Rake::Task["backfill_user_topic_items"].reenable
  end

  # SET LOCAL lasts until the spec's own transaction ends, so reset it to the audit trigger's "no user" value
  def as_audit_user(user_id)
    set_audit_user(user_id.to_s)
    yield
  ensure
    set_audit_user("")
  end

  def set_audit_user(value)
    ActiveRecord::Base.connection.execute(
      ActiveRecord::Base.sanitize_sql(["SET LOCAL audit.current_user_id = ?", value])
    )
  end

  def add_topic(topic, item, by: nil)
    return create(:topic_item, topic: topic, item: item) unless by

    as_audit_user(by.id) { create(:topic_item, topic: topic, item: item) }
  end

  def remove_topic(topic_item, by: nil)
    return topic_item.delete unless by

    as_audit_user(by.id) { topic_item.delete }
  end

  def tombstones(topic, item)
    DeletedTopicItem.where(topic: topic, item: item)
  end

  def tombstones_of_a_removal_elsewhere(by:)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(topic, notebook), by: by)
    tombstones(topic, notebook)
  end

  it "changes nothing without apply=true" do
    user = create(:user)
    notebook = create(:notebook)
    topic_item = add_topic(create(:topic, hub: notebook.hub), notebook, by: user)
    removed_topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(removed_topic, notebook), by: user)

    run_task(apply: false)

    expect(topic_item.reload.added_by).to be_nil
    expect(tombstones(removed_topic, notebook)).not_to exist
  end

  it "records the user who added a topic item to a notebook" do
    user = create(:user)
    notebook = create(:notebook)
    topic_item = add_topic(create(:topic, hub: notebook.hub), notebook, by: user)

    run_task

    expect(topic_item.reload.added_by).to eq(user)
  end

  it "leaves a topic item Knowledge Service added to a notebook without an adder" do
    notebook = create(:notebook)
    topic_item = add_topic(create(:topic, hub: notebook.hub), notebook)

    run_task

    expect(topic_item.reload.added_by).to be_nil
  end

  it "records a topic item a user removed from a notebook as removed from it" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(topic, notebook), by: user)

    run_task

    expect(tombstones(topic, notebook)).to exist
  end

  it "takes a topic item off only the notebook Knowledge Service gave it back to after a user removed it" do
    user = create(:user)
    notebook = create(:notebook)
    other_notebook = create(:notebook, hub: notebook.hub)
    topic = create(:topic, hub: notebook.hub)
    add_topic(topic, other_notebook)
    remove_topic(add_topic(topic, notebook), by: user)
    add_topic(topic, notebook)

    run_task

    expect(notebook.topics).not_to include(topic)
    expect(tombstones(topic, notebook)).to exist
    expect(other_notebook.topics).to include(topic)
  end

  it "restores a topic item a user added to a notebook that Knowledge Service then removed" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(topic, notebook, by: user))

    run_task

    expect(notebook.topic_items.find_by(topic: topic)).to have_attributes(added_by: user)
  end

  it "keeps a topic item a user removed from a notebook and then added again" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(topic, notebook, by: user), by: user)
    topic_item = add_topic(topic, notebook, by: user)

    run_task

    expect(topic_item.reload.added_by).to eq(user)
    expect(tombstones(topic, notebook)).not_to exist
  end

  it "records a topic item a user removed from a notebook several times as removed once" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    remove_topic(add_topic(topic, notebook), by: user)
    remove_topic(add_topic(topic, notebook), by: user)

    run_task

    expect(tombstones(topic, notebook).count).to eq(1)
  end

  it "ignores topic items removed because a user deleted the notebook" do
    user = create(:user)
    notebook = create(:notebook)
    add_topic(create(:topic, hub: notebook.hub), notebook)
    as_audit_user(user.id) { notebook.destroy! }
    removal_elsewhere = tombstones_of_a_removal_elsewhere(by: user)

    run_task

    expect(DeletedTopicItem.where(item: notebook)).not_to exist
    expect(removal_elsewhere).to exist
  end

  it "ignores topic items removed because a user deleted the topic" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    add_topic(topic, notebook)
    as_audit_user(user.id) { topic.destroy! }
    removal_elsewhere = tombstones_of_a_removal_elsewhere(by: user)

    run_task

    expect(DeletedTopicItem.where(topic_id: topic.id)).not_to exist
    expect(removal_elsewhere).to exist
  end

  it "ignores topic items removed from messages" do
    user = create(:user)
    topic = create(:topic)
    message = create(:message, :outgoing, conversation: create(:conversation, hub: topic.hub))
    remove_topic(add_topic(topic, message), by: user)
    removal_elsewhere = tombstones_of_a_removal_elsewhere(by: user)

    run_task

    expect(tombstones(topic, message)).not_to exist
    expect(removal_elsewhere).to exist
  end

  it "ignores changes made by an audit user that is not a user" do
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    topic_item = add_topic(topic, notebook)
    webhook_sender_phone_number = 5511999990000
    as_audit_user(webhook_sender_phone_number) { topic_item.delete }
    removal_elsewhere = tombstones_of_a_removal_elsewhere(by: create(:user))

    run_task

    expect(tombstones(topic, notebook)).not_to exist
    expect(removal_elsewhere).to exist
  end

  it "changes nothing on a second run" do
    user = create(:user)
    notebook = create(:notebook)
    topic = create(:topic, hub: notebook.hub)
    other_topic = create(:topic, hub: notebook.hub)
    add_topic(topic, notebook, by: user)
    remove_topic(add_topic(other_topic, notebook), by: user)
    run_task

    expect { run_task }.not_to change { [TopicItem.pluck(:id, :added_by_id), DeletedTopicItem.pluck(:id)] }
  end
end
