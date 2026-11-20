from redis import Redis

from app.core.config import Config

config = Config()

redis_client = Redis.from_url(config.redis_url)


def get_redis_client() -> Redis:
    return redis_client
