"""
Simple circuit breaker for external API calls (Gmail, Gemini, Claude, Resend).

States:
  CLOSED  → normal operation, requests pass through
  OPEN    → too many failures, requests fail fast (no external call)
  HALF_OPEN → after cooldown, allow one test request through

This prevents cascading failures when an external service goes down.
In-memory only — resets on deploy, which is acceptable for this use case.
"""
import time
import logging
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class CircuitState(str, Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"


class CircuitBreaker:
    def __init__(
        self,
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: int = 60,
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout  # seconds before trying again
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.last_failure_time: Optional[float] = None

    def can_execute(self) -> bool:
        """Check if a request is allowed through."""
        if self.state == CircuitState.CLOSED:
            return True

        if self.state == CircuitState.OPEN:
            # Check if recovery timeout has elapsed
            if self.last_failure_time and (time.time() - self.last_failure_time) >= self.recovery_timeout:
                self.state = CircuitState.HALF_OPEN
                logger.info(f"Circuit breaker '{self.name}' → HALF_OPEN (testing recovery)")
                return True
            return False

        # HALF_OPEN: allow one request through to test
        return True

    def record_success(self):
        """Record a successful call — reset the breaker."""
        if self.state != CircuitState.CLOSED:
            logger.info(f"Circuit breaker '{self.name}' → CLOSED (recovered)")
        self.failure_count = 0
        self.state = CircuitState.CLOSED

    def record_failure(self):
        """Record a failed call — may trip the breaker."""
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.failure_count >= self.failure_threshold:
            self.state = CircuitState.OPEN
            logger.warning(
                f"Circuit breaker '{self.name}' → OPEN "
                f"(failed {self.failure_count}x, cooling down {self.recovery_timeout}s)"
            )

    @property
    def is_open(self) -> bool:
        return self.state == CircuitState.OPEN


# ─── Pre-configured breakers for each external service ────────────────
gmail_breaker = CircuitBreaker("gmail", failure_threshold=5, recovery_timeout=60)
gemini_breaker = CircuitBreaker("gemini", failure_threshold=3, recovery_timeout=30)
claude_breaker = CircuitBreaker("claude", failure_threshold=3, recovery_timeout=30)
resend_breaker = CircuitBreaker("resend", failure_threshold=3, recovery_timeout=120)
