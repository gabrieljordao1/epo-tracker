"""
Centralized rate limiting via slowapi.

Uses in-memory storage (suitable for single-instance Railway deployment).
For distributed deployments (multiple instances), switch to Redis:
    limiter = Limiter(key_func=get_client_ip, storage_uri="redis://localhost:6379")

The key function reads X-Forwarded-For to get the real client IP behind
proxies (Railway, Cloudflare, Vercel). Falls back to request.client.host.
"""

import logging

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import JSONResponse

from .config import get_settings

logger = logging.getLogger(__name__)


def get_client_ip(request: Request) -> str:
    """Extract the real client IP, respecting X-Forwarded-For behind proxies.

    Railway / Cloudflare / Vercel all set X-Forwarded-For. The leftmost value
    is the original client; intermediary proxies append to the right.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Take the first (leftmost) IP — that's the original client
        client_ip = forwarded.split(",")[0].strip()
        if client_ip:
            return client_ip

    # Direct connection (no proxy)
    if request.client and request.client.host:
        return request.client.host

    return "unknown"


def _create_limiter() -> Limiter:
    """Create the limiter instance.

    In test environments (ENVIRONMENT=test), return a limiter with permissive
    defaults so existing tests don't break from rate limiting. Per-endpoint
    decorators still apply but the test can override via app config.
    """
    settings = get_settings()
    enabled = settings.ENVIRONMENT != "test"

    return Limiter(
        key_func=get_client_ip,
        enabled=enabled,
        default_limits=[f"{settings.RATE_LIMIT_PER_MINUTE}/minute"],
        # In-memory storage. For multi-instance deployments, use:
        # storage_uri="redis://localhost:6379"
    )


limiter = _create_limiter()


def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    """Custom 429 handler that returns JSON instead of plain text."""
    logger.warning(
        f"Rate limit exceeded: {get_client_ip(request)} on {request.method} {request.url.path} "
        f"— limit: {exc.detail}"
    )
    return JSONResponse(
        status_code=429,
        content={
            "detail": "Rate limit exceeded. Try again later.",
            "retry_after": str(exc.detail),
        },
    )
