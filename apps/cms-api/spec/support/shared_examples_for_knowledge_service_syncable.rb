RSpec.shared_examples "knowledge_service_syncable" do
  let(:ingestible_attributes) { {} }

  describe "KnowledgeServiceSyncable" do
    let(:model_instance) { described_class.name.underscore.to_sym }

    context "priority_tier validation" do
      it "accepts PRIORITY_TIER_LOW" do
        instance = build(model_instance, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_LOW)
        expect(instance).to be_valid
      end

      it "rejects an unknown priority_tier" do
        instance = build(model_instance, priority_tier: 0)
        expect(instance).not_to be_valid
      end
    end

    context "when active status changes from true to false" do
      it "removes the item from knowledge service" do
        instance = create(model_instance, active: true)
        expect(instance).to receive(:remove_from_knowledge_service)
        instance.update(active: false)
      end
    end

    context "when active status changes from false to true" do
      it "sends the item to knowledge service" do
        instance = create(model_instance, active: false)
        expect(instance).to receive(:send_to_knowledge_service)
        instance.update(active: true)
      end
    end

    context "when active status does not change" do
      it "does not trigger knowledge service sync when active remains true" do
        instance = create(model_instance, active: true)
        expect(instance).not_to receive(:send_to_knowledge_service)
        expect(instance).not_to receive(:remove_from_knowledge_service)
        instance.update(updated_at: Time.current)
      end

      it "does not trigger knowledge service sync when active remains false" do
        instance = create(model_instance, active: false)
        expect(instance).not_to receive(:send_to_knowledge_service)
        expect(instance).not_to receive(:remove_from_knowledge_service)
        instance.update(updated_at: Time.current)
      end
    end

    context "when priority_tier changes" do
      it "sends the item to knowledge service" do
        instance = create(model_instance, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
        expect(instance).to receive(:send_to_knowledge_service)
        instance.update(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_HIGH)
      end

      it "sets sync_status to pending" do
        instance = create(model_instance, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
        instance.update(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_HIGH)
        expect(instance.reload.sync_status).to eq("pending")
      end
    end

    context "when priority_tier does not change" do
      it "does not trigger knowledge service sync" do
        instance = create(model_instance, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
        expect(instance).not_to receive(:send_to_knowledge_service)
        expect(instance).not_to receive(:remove_from_knowledge_service)
        instance.update(updated_at: Time.current)
      end
    end

    context "when priority_tier changes but record is inactive" do
      it "does not send to knowledge service" do
        instance = create(model_instance, active: false, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
        expect(instance).not_to receive(:send_to_knowledge_service)
        instance.update(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_HIGH)
      end
    end

    context "when creating a new record" do
      it "does not trigger the knowledge service sync callback" do
        instance = build(model_instance)
        expect(instance).not_to receive(:handle_knowledge_service_sync)
        instance.save
      end
    end

    describe "sync_status" do
      it "sets sync_status to pending on creation" do
        instance = create(model_instance)
        expect(instance.reload.sync_status).to eq("pending")
      end

      it "sets sync_status to pending when active status changes to false" do
        instance = create(model_instance, active: true)
        instance.update(active: false)
        expect(instance.reload.sync_status).to eq("pending")
      end

      it "sets sync_status to pending when active status changes to true" do
        instance = create(model_instance, active: false)
        instance.update(active: true)
        expect(instance.reload.sync_status).to eq("pending")
      end
    end

    describe "#retryable?" do
      it "is false when sync_status is pending, regardless of any stored error code" do
        instance = build(model_instance, sync_status: :pending, last_sync_error_code: nil)
        expect(instance.retryable?).to be(false)
      end

      it "is false when sync_status is complete" do
        instance = build(model_instance, sync_status: :complete, last_sync_error_code: nil)
        expect(instance.retryable?).to be(false)
      end

      context "when sync_status is error" do
        it "is true when there is no error code" do
          instance = build(model_instance, sync_status: :error, last_sync_error_code: nil)
          expect(instance.retryable?).to be(true)
        end

        it "is true when the error code is unrecognized" do
          instance = build(model_instance, sync_status: :error, last_sync_error_code: "SOME_FUTURE_CODE")
          expect(instance.retryable?).to be(true)
        end

        it "is false when the error code is NO_TEXT_FOUND" do
          instance = build(model_instance, sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
          expect(instance.retryable?).to be(false)
        end

        it "is false when the error code is TEXT_TOO_LARGE" do
          instance = build(model_instance, sync_status: :error, last_sync_error_code: "TEXT_TOO_LARGE")
          expect(instance.retryable?).to be(false)
        end

        it "is false when the error code is PDF_PASSWORD_PROTECTED" do
          instance = build(model_instance, sync_status: :error, last_sync_error_code: "PDF_PASSWORD_PROTECTED")
          expect(instance.retryable?).to be(false)
        end
      end
    end

    describe ".non_retryable" do
      it "includes instances with a non-retryable error" do
        instance = create(model_instance)
        instance.update_columns(sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
        expect(described_class.non_retryable).to include(instance)
      end

      it "excludes instances with a retryable error" do
        instance = create(model_instance)
        instance.update_columns(sync_status: :error, last_sync_error_code: nil)
        expect(described_class.non_retryable).not_to include(instance)
      end

      it "excludes instances without an error" do
        instance = create(model_instance)
        instance.update_columns(sync_status: :complete, last_sync_error_code: nil)
        expect(described_class.non_retryable).not_to include(instance)
      end
    end

    describe "#as_json" do
      it "surfaces retryable? as the retryable key" do
        instance = build(model_instance, sync_status: :error, last_sync_error_code: nil)
        expect(instance.as_json[:retryable]).to be(true)

        instance = build(model_instance, sync_status: :error, last_sync_error_code: "NO_TEXT_FOUND")
        expect(instance.as_json[:retryable]).to be(false)
      end
    end

    describe "stale sync scheduling" do
      it "schedules a StaleSyncWorker check when created active" do
        instance = build(model_instance, active: true)
        expect(StaleSyncWorker).to receive(:perform_in).with(24.hours, described_class.name, kind_of(Integer))
        instance.save
      end

      it "does not schedule a check when created inactive" do
        instance = build(model_instance, active: false)
        expect(StaleSyncWorker).not_to receive(:perform_in)
        instance.save
      end

      it "schedules a new check when active status changes" do
        instance = create(model_instance, active: true)
        expect(StaleSyncWorker).to receive(:perform_in).with(24.hours, described_class.name, instance.id)
        instance.update(active: false)
      end

      it "schedules a new check when priority_tier changes" do
        instance = create(model_instance, priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_DEFAULT)
        expect(StaleSyncWorker).to receive(:perform_in).with(24.hours, described_class.name, instance.id)
        instance.update(priority_tier: KnowledgeServiceSyncable::PRIORITY_TIER_HIGH)
      end
    end

    describe "#sync_topics_to_knowledge_service" do
      it "enqueues a topics sync when the item is active and synced" do
        instance = create(model_instance, active: true, **ingestible_attributes)
        instance.update_columns(sync_status: :complete)

        freeze_time do
          expect { instance.sync_topics_to_knowledge_service }.to change { sync_topics_jobs.size }.by(1)
          expect(sync_topics_jobs.last["args"]).to eq(["sync_topics", "#{described_class.name}/#{instance.id}"])
          expect(sync_topics_jobs.last["at"]).to eq(KnowledgeServiceSyncable::TOPICS_SYNC_DELAY.from_now.to_f)
        end
      end

      it "enqueues one sync for several changes in a row" do
        use_memory_cache
        instance = create(model_instance, active: true, **ingestible_attributes)
        instance.update_columns(sync_status: :complete)

        expect { 3.times { instance.sync_topics_to_knowledge_service } }.to change { sync_topics_jobs.size }.by(1)
      end

      it "does not enqueue while the item is pending" do
        instance = create(model_instance, active: true, **ingestible_attributes)
        instance.update_columns(sync_status: :pending)

        expect { instance.sync_topics_to_knowledge_service }.not_to change { sync_topics_jobs.size }
      end

      it "does not enqueue when the item has a sync error" do
        instance = create(model_instance, active: true, **ingestible_attributes)
        instance.update_columns(sync_status: :error)

        expect { instance.sync_topics_to_knowledge_service }.not_to change { sync_topics_jobs.size }
      end

      it "does not enqueue when the item is inactive" do
        instance = create(model_instance, active: false, **ingestible_attributes)
        instance.update_columns(sync_status: :complete)

        expect { instance.sync_topics_to_knowledge_service }.not_to change { sync_topics_jobs.size }
      end
    end
  end
end
