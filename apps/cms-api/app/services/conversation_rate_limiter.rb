class ConversationRateLimiter
  def initialize(conversation)
    @conversation = conversation
  end

  # Check if conversation is locked (rate limit reached)
  def locked?
    limit = ENV.fetch("MESSAGE_RATE_LIMIT", "3").to_i
    return false if limit <= 0 # Disabled if limit is 0 or negative

    redis_get(lock_key).to_i >= limit
  end

  # Acquire lock (increment counter) with TTL
  def acquire!
    timeout_minutes = ENV.fetch("MESSAGE_RATE_LIMIT_TIMEOUT_MINUTES", "30").to_f

    Sidekiq.redis do |conn|
      # Increment the counter atomically
      new_count = conn.incr(lock_key)

      # Set expiration on first increment
      if new_count == 1
        conn.expire(lock_key, (timeout_minutes * 60).to_i)
      end
    end

    true
  end

  # Release lock (decrement counter)
  def release!
    Sidekiq.redis do |conn|
      current = conn.get(lock_key).to_i

      if current > 0
        new_count = conn.decr(lock_key)
        # Remove key if counter reaches 0
        conn.del(lock_key) if new_count <= 0
      end
    end

    true
  end

  # Reset lock completely (useful for testing or manual intervention)
  def reset!
    Sidekiq.redis do |conn|
      conn.del(lock_key)
    end
    true
  end

  private

  def lock_key
    "conversation_rate_limit:#{@conversation.id}"
  end

  def redis_get(key)
    Sidekiq.redis do |conn|
      conn.get(key)
    end
  end
end
