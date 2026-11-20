import functools
from typing import Any

import boto3
from botocore.config import Config as BotoConfig


@functools.cache
def get_bedrock_client(read_timeout_seconds: float = 60.0, max_retries: int | None = None) -> Any:
    from app.core.config import Config

    config = Config()
    boto_config = BotoConfig(
        connect_timeout=10,
        read_timeout=read_timeout_seconds,
        # botocore counts max_attempts as retries only (total attempts = max_attempts + 1)
        retries={"mode": "standard", "max_attempts": max_retries} if max_retries is not None else None,
    )
    return boto3.client(
        service_name="bedrock-runtime",
        region_name=config.aws_region,
        config=boto_config,
    )
