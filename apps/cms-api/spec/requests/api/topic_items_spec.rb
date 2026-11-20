require "rails_helper"

RSpec.describe "Topic Items API", type: :request do
  let!(:user) { create(:user) }
  let!(:hub) { create(:hub, users: [user]) }
  let!(:document) { create(:document, source: create(:source, hub: hub)) }
  let!(:topic) { create(:topic, hub: hub) }
  let!(:topic_item) { create(:topic_item, topic: topic, item: document) }
  let(:headers) { auth_headers_for(user) }

  context "when adding a topic to an item" do
    let!(:other_topic) { create(:topic, hub: hub) }
    let(:params) { {topic_id: other_topic.id, item_type: "Document", item_id: document.id} }

    it "adds the topic to the item for a hub member" do
      expect {
        post "/api/topic-items", params: params, headers: headers
      }.to change { document.topics.count }.by(1)

      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("name" => other_topic.name, "topic_created" => false)
      expect(document.reload.topics).to include(other_topic)
    end

    it "records the user who added the topic" do
      post "/api/topic-items", params: params, headers: headers

      expect(document.topic_items.find_by(topic: other_topic).added_by).to eq(user)
    end

    it "works for contributions and notebooks" do
      contribution = create(:contribution, hub: hub)
      notebook = create(:notebook, hub: hub)

      post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Contribution", item_id: contribution.id}, headers: headers
      expect(response).to have_http_status(:created)
      expect(contribution.topic_items.sole.added_by).to eq(user)

      post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Notebook", item_id: notebook.id}, headers: headers
      expect(response).to have_http_status(:created)
      expect(notebook.topic_items.sole.added_by).to eq(user)
    end

    it "does not notify the subscribers of the topic" do
      public_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))

      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: public_document.id}, headers: headers
      }.not_to change(TopicSubscriptionNotificationWorker.jobs, :size)

      expect(response).to have_http_status(:created)
    end

    it "does not add a topic the item already has" do
      expect {
        post "/api/topic-items", params: {topic_id: topic.id, item_type: "Document", item_id: document.id}, headers: headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "does not add a topic to an item of another hub" do
      other_document = create(:document, source: create(:source, hub: create(:hub)))

      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: other_document.id}, headers: headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:not_found)
    end

    it "does not add a topic of another hub" do
      foreign_topic = create(:topic, hub: create(:hub))

      expect {
        post "/api/topic-items", params: params.merge(topic_id: foreign_topic.id), headers: headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:not_found)
    end

    it "does not add topics to other kinds of item" do
      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Message", item_id: document.id}, headers: headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "returns not found if the item does not exist" do
      post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: 0}, headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if the user is not part of the hub of the item" do
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      expect {
        post "/api/topic-items", params: params, headers: other_headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if the topic does not exist" do
      post "/api/topic-items", params: params.merge(topic_id: 0), headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end

  context "when adding a topic by name" do
    let(:params) { {topic_name: "Public transport", item_type: "Document", item_id: document.id} }

    it "creates the topic in the hub of the item and adds it to the item" do
      expect {
        post "/api/topic-items", params: params, headers: headers
      }.to change { hub.topics.count }.by(1).and change { document.topics.count }.by(1)

      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("name" => "Public transport", "topic_created" => true)
      expect(hub.topics.find_by(name: "Public transport").topic_items.map(&:item)).to eq([document])
    end

    it "records the user who added the topic" do
      post "/api/topic-items", params: params, headers: headers

      expect(hub.topics.find_by(name: "Public transport").topic_items.sole.added_by).to eq(user)
    end

    it "uses the topic the hub already has of that name, whatever the case, and creates none" do
      existing = create(:topic, hub: hub, name: "Public Transport")

      expect {
        post "/api/topic-items", params: params, headers: headers
      }.not_to change { Topic.count }

      expect(response).to have_http_status(:created)
      expect(response.parsed_body).to include("name" => "Public Transport", "topic_created" => false)
      expect(document.reload.topics).to include(existing)
    end

    it "does not use a topic of the same name in another hub" do
      other_hub_topic = create(:topic, name: "Public transport")

      post "/api/topic-items", params: params, headers: headers

      expect(response).to have_http_status(:created)
      expect(document.reload.topics).not_to include(other_hub_topic)
      expect(hub.topics.where(name: "Public transport").count).to eq(1)
    end

    it "trims the name and collapses the spaces in it" do
      post "/api/topic-items", params: params.merge(topic_name: "  Public    transport \n"), headers: headers

      expect(response.parsed_body).to include("name" => "Public transport")
    end

    it "does not notify the subscribers of a topic it finds" do
      public_document = create(:document, source: create(:source, hub: hub, source_type: :rss_feed))
      create(:topic, hub: hub, name: "Public transport")

      expect {
        post "/api/topic-items", params: params.merge(item_id: public_document.id), headers: headers
      }.not_to change(TopicSubscriptionNotificationWorker.jobs, :size)
    end

    it "does not create a topic with no name" do
      expect {
        post "/api/topic-items", params: params.merge(topic_name: "   "), headers: headers
      }.not_to change { Topic.count }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "does not create a topic with a name that is too long" do
      expect {
        post "/api/topic-items", params: params.merge(topic_name: "a" * 256), headers: headers
      }.not_to change { Topic.count }

      expect(response).to have_http_status(:unprocessable_content)
      expect(response.parsed_body["errors"].first).to include("255")
    end

    it "does not add a topic the item already has under that name" do
      create(:topic_item, topic: create(:topic, hub: hub, name: "Public transport"), item: document)

      expect {
        post "/api/topic-items", params: params, headers: headers
      }.not_to change { TopicItem.count }

      expect(response).to have_http_status(:unprocessable_content)
    end

    context "when the user is an editor of the hub, not an admin" do
      let(:editor_headers) do
        editor = create(:user, email: Faker::Internet.email)
        create(:hub_membership, hub: hub, user: editor, role: "editor")
        auth_headers_for(editor)
      end

      it "returns forbidden, and creates nothing, for a name the hub has no topic of" do
        expect {
          post "/api/topic-items", params: params, headers: editor_headers
        }.not_to change { [Topic.count, TopicItem.count] }

        expect(response).to have_http_status(:forbidden)
      end

      it "adds the topic the hub already has of that name, whatever the case" do
        existing = create(:topic, hub: hub, name: "Public Transport")

        topic_count = Topic.count

        expect {
          post "/api/topic-items", params: params, headers: editor_headers
        }.to change { document.topics.count }.by(1)

        expect(Topic.count).to eq(topic_count)

        expect(response).to have_http_status(:created)
        expect(response.parsed_body).to include("topic_created" => false)
        expect(document.reload.topics).to include(existing)
      end
    end

    it "returns not found, and creates nothing, if the user is not part of the hub of the item" do
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      expect {
        post "/api/topic-items", params: params, headers: other_headers
      }.not_to change { Topic.count }

      expect(response).to have_http_status(:not_found)
    end

    it "returns not found if the item does not exist" do
      post "/api/topic-items", params: params.merge(item_id: 0), headers: headers

      expect(response).to have_http_status(:not_found)
    end

    it "does not create topics for other kinds of item" do
      expect {
        post "/api/topic-items", params: params.merge(item_type: "Message"), headers: headers
      }.not_to change { Topic.count }

      expect(response).to have_http_status(:unprocessable_content)
    end
  end

  context "when removing a topic from an item" do
    it "destroys the topic item for a hub member" do
      expect {
        delete "/api/topic-items/#{topic_item.id}", headers: headers
      }.to change { TopicItem.count }.by(-1)

      expect(response).to have_http_status(:ok)
      expect(document.reload.topics).to be_empty
    end

    it "removes a topic that was removed and added back before" do
      delete "/api/topic-items/#{topic_item.id}", headers: headers
      post "/api/topic-items", params: {topic_id: topic.id, item_type: "Document", item_id: document.id}, headers: headers

      delete "/api/topic-items/#{response.parsed_body["id"]}", headers: headers

      expect(response).to have_http_status(:ok)
      expect(document.reload.topics).to be_empty
    end

    it "does not remove the topic itself" do
      delete "/api/topic-items/#{topic_item.id}", headers: headers

      expect(Topic.exists?(topic.id)).to be true
    end

    it "returns not found if the user is not part of the hub" do
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      delete "/api/topic-items/#{topic_item.id}", headers: other_headers

      expect(response).to have_http_status(:not_found)
      expect(TopicItem.exists?(topic_item.id)).to be true
    end

    it "returns not found if the topic item does not exist" do
      delete "/api/topic-items/0", headers: headers

      expect(response).to have_http_status(:not_found)
    end
  end

  context "when syncing the topics to the Knowledge Service" do
    let!(:other_topic) { create(:topic, hub: hub) }

    it "enqueues one sync when a topic is added by id" do
      document.update_columns(sync_status: :complete)

      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: document.id}, headers: headers
      }.to change { sync_topics_jobs.size }.by(1)

      expect(sync_topics_jobs.last["args"]).to eq(["sync_topics", "Document/#{document.id}"])
    end

    it "enqueues one sync when a user adds and removes several topics in a row" do
      use_memory_cache
      document.update_columns(sync_status: :complete)

      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: document.id}, headers: headers
        post "/api/topic-items", params: {topic_name: "Public transport", item_type: "Document", item_id: document.id}, headers: headers
        delete "/api/topic-items/#{topic_item.id}", headers: headers
      }.to change { sync_topics_jobs.size }.by(1)

      expect(document.reload.topics.map(&:name)).to contain_exactly(other_topic.name, "Public transport")
    end

    it "enqueues one sync when a topic is added by name" do
      document.update_columns(sync_status: :complete)

      expect {
        post "/api/topic-items", params: {topic_name: other_topic.name, item_type: "Document", item_id: document.id}, headers: headers
      }.to change { sync_topics_jobs.size }.by(1)
    end

    it "enqueues one sync when a topic is removed" do
      document.update_columns(sync_status: :complete)

      expect {
        delete "/api/topic-items/#{topic_item.id}", headers: headers
      }.to change { sync_topics_jobs.size }.by(1)
    end

    it "does not enqueue a sync while the item is still syncing" do
      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: document.id}, headers: headers
      }.not_to change { sync_topics_jobs.size }
    end

    it "does not enqueue a sync for a user outside the hub" do
      document.update_columns(sync_status: :complete)
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      expect {
        post "/api/topic-items", params: {topic_id: other_topic.id, item_type: "Document", item_id: document.id}, headers: other_headers
      }.not_to change { sync_topics_jobs.size }

      expect(response).to have_http_status(:not_found)
    end

    it "does not enqueue a sync when the item already has the topic" do
      document.update_columns(sync_status: :complete)

      expect {
        post "/api/topic-items", params: {topic_id: topic.id, item_type: "Document", item_id: document.id}, headers: headers
      }.not_to change { sync_topics_jobs.size }

      expect(response).to have_http_status(:unprocessable_content)
    end

    it "does not enqueue a sync when a user outside the hub removes a topic" do
      document.update_columns(sync_status: :complete)
      other_headers = auth_headers_for(create(:user, email: Faker::Internet.email))

      expect {
        delete "/api/topic-items/#{topic_item.id}", headers: other_headers
      }.not_to change { sync_topics_jobs.size }

      expect(response).to have_http_status(:not_found)
    end
  end
end

# Tests for Swagger / OpenAPI documentation

require "swagger_helper"

describe "Topic Items API" do
  path "/api/topic-items" do
    post "Adds a topic of the hub to a data source item, creating the topic if the hub has none of that name" do
      tags "Topic Item"
      consumes "application/json"
      produces "application/json"
      security [bearerAuth: []]
      parameter name: :topic_item, in: :body, schema: {
        type: :object,
        properties: {
          topic_id: {type: :integer, description: "ID of a topic of the hub of the item. Not needed when topic_name is given"},
          topic_name: {type: :string, description: "Name of the topic to add, which is created if the hub has none of that name, whatever the case"},
          item_type: {type: :string, enum: %w[Document Contribution Notebook], description: "Kind of data source item"},
          item_id: {type: :integer, description: "ID of the item"}
        },
        required: %w[item_type item_id]
      }

      response "201", "Topic added to the item; topic_created says whether it was created first" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:document) { create(:document, source: create(:source, hub: hub)) }
        let!(:topic) { create(:topic, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:topic_item) { {topic_id: topic.id, item_type: "Document", item_id: document.id} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
          expect(response.parsed_body).to include("name" => topic.name)
        end
      end

      response "201", "Topic added to the item; topic_created says whether it was created first" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:document) { create(:document, source: create(:source, hub: hub)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:topic_item) { {topic_name: "A new topic", item_type: "Document", item_id: document.id} }
        run_test! do |response|
          expect(response).to have_http_status(:created)
          expect(response.parsed_body).to include("name" => "A new topic")
        end
      end

      response "403", "Forbidden: creating a topic of the hub is for admins" do
        let!(:admin) { create(:user) }
        let!(:hub) { create(:hub, users: [admin]) }
        let!(:document) { create(:document, source: create(:source, hub: hub)) }
        let!(:editor) { create(:hub_membership, hub: hub, user: create(:user), role: "editor").user }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(editor, :user, nil)
          "Bearer #{token}"
        end
        let(:topic_item) { {topic_name: "A new topic", item_type: "Document", item_id: document.id} }
        run_test! do |response|
          expect(response).to have_http_status(:forbidden)
        end
      end

      response "401", "Unauthorized" do
        let(:Authorization) { nil }
        let(:topic_item) { {topic_id: 1, item_type: "Document", item_id: 1} }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:topic) { create(:topic) }
        let!(:document) { create(:document, source: create(:source, hub: topic.hub)) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:topic_item) { {topic_id: topic.id, item_type: "Document", item_id: document.id} }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end

      response "422", "The topic could not be added to the item" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:document) { create(:document, source: create(:source, hub: hub)) }
        let!(:topic) { create(:topic, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:topic_item) { {topic_id: topic.id, item_type: "Message", item_id: document.id} }
        run_test! do |response|
          expect(response).to have_http_status(:unprocessable_content)
        end
      end
    end
  end

  path "/api/topic-items/{id}" do
    delete "Removes a topic from a data source item" do
      tags "Topic Item"
      consumes "application/json"
      security [bearerAuth: []]
      parameter name: :id, in: :path, type: :string, description: "Topic Item ID"

      response "200", "Topic removed from the item successfully" do
        let!(:user) { create(:user) }
        let!(:hub) { create(:hub, users: [user]) }
        let!(:topic_item) { create(:topic_item, hub: hub) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { topic_item.id }
        run_test! do |response|
          expect(response).to have_http_status(:ok)
        end
      end

      response "401", "Unauthorized" do
        let!(:topic_item) { create(:topic_item) }
        let(:Authorization) { nil }
        let(:id) { topic_item.id }
        run_test! do |response|
          expect(response).to have_http_status(:unauthorized)
        end
      end

      response "404", "Not found" do
        let!(:user) { create(:user) }
        let!(:topic_item) { create(:topic_item) }
        let(:Authorization) do
          token, _ = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
          "Bearer #{token}"
        end
        let(:id) { topic_item.id }
        run_test! do |response|
          expect(response).to have_http_status(:not_found)
        end
      end
    end
  end
end
