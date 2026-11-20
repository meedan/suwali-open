module KnowledgeServiceJobsHelper
  def sync_topics_jobs
    KnowledgeServiceWorker.jobs.select { |job| job["args"].first == "sync_topics" }
  end

  # The test cache store is a null store, which never holds the flag that debounces syncs
  def use_memory_cache
    allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::MemoryStore.new)
  end
end
