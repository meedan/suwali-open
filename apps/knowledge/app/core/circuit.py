from circuitbreaker import CircuitBreaker


class LLMCircuitBreaker(CircuitBreaker):  # type: ignore[misc]
    FAILURE_THRESHOLD = 3
    RECOVERY_TIMEOUT = 10  # seconds
