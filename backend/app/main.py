import logging
import time
import uuid
import re
from contextlib import asynccontextmanager
from collections import defaultdict

from fastapi import FastAPI, Depends, Request, Response, HTTPException, status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .core.config import get_settings

# ─── Sentry Error Monitoring ──────────────
_settings = get_settings()
if _settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.sqlalchemy import SqlalchemyIntegration

    def sentry_before_send(event, hint):
        """Strip sensitive data from error reports before sending to Sentry."""
        if event.get("request"):
            req = event["request"]
            # Strip Authorization headers
            if req.get("headers"):
                req["headers"].pop("Authorization", None)
                req["headers"].pop("authorization", None)
            # Strip passwords and tokens from data
            if req.get("data"):
                req["data"] = _redact_sensitive_data(req.get("data", ""))

        # Strip sensitive data from exception messages
        if event.get("exception"):
            for exc in event["exception"].get("values", []):
                if exc.get("value"):
                    exc["value"] = _redact_sensitive_data(exc["value"])

        # Strip from breadcrumbs
        if event.get("breadcrumbs"):
            for breadcrumb in event["breadcrumbs"]:
                if breadcrumb.get("data"):
                    breadcrumb["data"] = _redact_sensitive_data(str(breadcrumb["data"]))

        return event

    def _redact_sensitive_data(text: str) -> str:
        """Redact passwords, tokens, and API keys from text."""
        text = str(text)
        # Redact common patterns
        text = re.sub(r'password["\']?\s*[:=]\s*["\']?[^"\'&\s]+["\']?', 'password=***REDACTED***', text, flags=re.IGNORECASE)
        text = re.sub(r'token["\']?\s*[:=]\s*["\']?[^"\'&\s]+["\']?', 'token=***REDACTED***', text, flags=re.IGNORECASE)
        text = re.sub(r'api[_-]?key["\']?\s*[:=]\s*["\']?[^"\'&\s]+["\']?', 'api_key=***REDACTED***', text, flags=re.IGNORECASE)
        text = re.sub(r'authorization["\']?\s*[:=]\s*["\']?Bearer\s+[^"\'&\s]+["\']?', 'authorization=***REDACTED***', text, flags=re.IGNORECASE)
        return text

    sentry_sdk.init(
        dsn=_settings.SENTRY_DSN,
        environment=_settings.ENVIRONMENT,
        traces_sample_rate=0.2 if _settings.ENVIRONMENT == "production" else 1.0,
        profiles_sample_rate=0.1,
        integrations=[FastApiIntegration(), SqlalchemyIntegration()],
        send_default_pii=False,
        before_send=sentry_before_send,
        release=getattr(_settings, "APP_VERSION", "unknown"),
    )

from .core.database import init_db, close_db, get_db  # noqa: E402
from .core.auth import get_current_user, decode_token, security  # noqa: E402
from .api import auth, epos, demo, team, email_sync, vendor_portal, exports, activity, gmail_webhook, attachments, approvals, notifications, portal, billing, builder_analytics, daily_reports, punch_list, budgets, work_orders, sub_payments  # noqa: E402
from .models.models import User  # noqa: E402

settings = get_settings()

# ─── Logging ───────────────────────────────────
logging.basicConfig(
    level=getattr(logging, settings.LOG_LEVEL, logging.INFO),
    format="%(asctime)s | %(levelname)-7s | %(name)s | %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("epo_tracker")


# ─── Rate Limiter (in-memory, simple) ──────────
class RateLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, calls_per_minute: int = 60):
        super().__init__(app)
        self.calls_per_minute = calls_per_minute
        self.requests: dict = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health checks and docs
        if request.url.path in ("/api/health", "/docs", "/openapi.json", "/"):
            return await call_next(request)

        # Determine rate limit key: prefer authenticated user ID over IP
        rate_limit_key = self._get_rate_limit_key(request)
        now = time.time()
        window = 60  # seconds

        # Clean old entries
        self.requests[rate_limit_key] = [
            t for t in self.requests[rate_limit_key] if now - t < window
        ]

        if len(self.requests[rate_limit_key]) >= self.calls_per_minute:
            key_type = "user" if rate_limit_key.startswith("user_") else "ip"
            logger.warning(f"Rate limit exceeded for {key_type}={rate_limit_key} on {request.url.path}")
            return Response(
                content='{"detail":"Rate limit exceeded. Try again in a minute."}',
                status_code=429,
                media_type="application/json",
            )

        self.requests[rate_limit_key].append(now)
        return await call_next(request)

    def _get_rate_limit_key(self, request: Request) -> str:
        """Get the rate limit key: prefer user ID if authenticated, fall back to IP."""
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from .core.auth import decode_token
                token = auth_header.replace("Bearer ", "")
                payload = decode_token(token)
                if payload and payload.get("sub"):
                    return f"user_{payload.get('sub')}"
            except Exception:
                pass

        # Fall back to IP address
        client_ip = request.client.host if request.client else "unknown"
        return f"ip_{client_ip}"


# ─── Request Logging Middleware ─────────────────
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.time()

        # Extract request body size for POST/PUT requests
        request_body_size = 0
        if request.method in ["POST", "PUT", "PATCH"]:
            # Try to get content-length header
            content_length = request.headers.get("content-length")
            if content_length:
                request_body_size = int(content_length)

        # Extract user ID from Authorization header if available
        user_id = None
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from .core.auth import decode_token
                token = auth_header.replace("Bearer ", "")
                payload = decode_token(token)
                if payload:
                    user_id = payload.get("sub")
            except Exception:
                # Silent fail if token decode fails - request may not be authenticated
                pass

        response = await call_next(request)

        duration = round((time.time() - start) * 1000)

        # Build log message
        log_parts = [
            f"[{request_id}]",
            f"{request.method}",
            f"{request.url.path}",
            f"→ {response.status_code}",
            f"({duration}ms)"
        ]

        if request.method in ["POST", "PUT", "PATCH"] and request_body_size > 0:
            log_parts.append(f"req_size={request_body_size}B")

        if user_id:
            log_parts.append(f"user_id={user_id}")

        log_message = " ".join(log_parts)

        # Log at WARNING level if request took > 2 seconds
        if duration > 2000:
            logger.warning(log_message)
        else:
            logger.info(log_message)

        # Add response headers
        response.headers["X-Request-ID"] = request_id
        if "content-length" in response.headers:
            response.headers["X-Response-Size"] = response.headers["content-length"]

        return response


# ─── Security Headers Middleware ────────────────
class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        if settings.ENVIRONMENT == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# ─── App Lifecycle ──────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(f"Starting {settings.APP_NAME} [{settings.ENVIRONMENT}]")
    await init_db()

    # Start background scheduler
    from .services.scheduler import start_scheduler
    if settings.ENVIRONMENT != "development" or settings.DEBUG:
        start_scheduler()

    yield
    await close_db()
    logger.info(f"{settings.APP_NAME} shutdown complete")


# ─── App Factory ────────────────────────────────
def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.APP_NAME,
        description="EPO Tracker — vendor-facing EPO management SaaS",
        version="1.0.0",
        lifespan=lifespan,
        docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
        redoc_url="/redoc" if settings.ENVIRONMENT != "production" else None,
    )

    # Middleware (order matters — last added = first executed)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)
    app.add_middleware(RateLimitMiddleware, calls_per_minute=settings.RATE_LIMIT_PER_MINUTE)

    # CORS — use whitelist in production for security
    cors_origins = []
    if settings.ENVIRONMENT == "production":
        # Production: use strict whitelist with frontend and API URLs
        cors_origins = [
            settings.APP_URL,  # Frontend
            settings.API_URL,  # API
        ]
        # Remove duplicates and empty strings
        cors_origins = list(set(origin.strip() for origin in cors_origins if origin.strip()))
        logger.info(f"CORS (production mode): {cors_origins}")
    else:
        # Development/staging: use configured origins or allow all
        cors_origins = settings.CORS_ORIGINS
        if not cors_origins or cors_origins == ["*"]:
            cors_origins = ["*"]
            logger.info("CORS (development mode): allowing all origins")
        else:
            logger.info(f"CORS (staging mode): {cors_origins}")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID", "X-Response-Size"],
    )

    # ─── Global Exception Handler ───
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        """Handle unhandled exceptions: log, report to Sentry, return clean 500."""
        request_id = request.headers.get("X-Request-ID", str(uuid.uuid4())[:8])

        # Log the full traceback
        logger.error(
            f"[{request_id}] Unhandled exception in {request.method} {request.url.path}",
            exc_info=exc,
        )

        # Add user context to Sentry if available
        if _settings.SENTRY_DSN:
            try:
                import sentry_sdk
                auth_header = request.headers.get("authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header.replace("Bearer ", "")
                    payload = decode_token(token)
                    if payload and payload.get("sub"):
                        user_id = payload.get("sub")
                        sentry_sdk.set_user({"id": user_id})
                        # Try to get email from payload
                        if payload.get("email"):
                            sentry_sdk.set_context("user", {"id": user_id, "email": payload.get("email")})
            except Exception:
                pass  # Silent fail if we can't extract user info

        # Return 500 response — include exception details on /api/epos/backfill-amounts
        # so we can debug in production. Other endpoints stay clean.
        import traceback as _tb
        tb_str = _tb.format_exc()
        path = request.url.path
        expose_error = (
            path.endswith("/backfill-amounts")
            or path.endswith("/sync-recent")
            or settings.ENVIRONMENT != "production"
            or settings.DEBUG
        )
        if expose_error:
            return JSONResponse(
                status_code=500,
                content={
                    "detail": f"{type(exc).__name__}: {str(exc)[:400]}",
                    "request_id": request_id,
                    "path": path,
                    "traceback": tb_str.split("\n")[-10:],
                },
            )
        return JSONResponse(
            status_code=500,
            content={
                "detail": "Internal server error",
                "request_id": request_id,
            },
        )

    # ─── Auth dependency override ───
    async def get_current_user_with_session(
        credentials: HTTPAuthorizationCredentials = Depends(security),
        session: AsyncSession = Depends(get_db),
    ) -> User:
        payload = decode_token(credentials.credentials)
        if payload is None:
            raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        user_id = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

        result = await session.execute(select(User).where(User.id == int(user_id)))
        user = result.scalars().first()
        if user is None:
            raise HTTPException(status_code=http_status.HTTP_401_UNAUTHORIZED, detail="User not found")
        if not user.is_active:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Account disabled")
        return user

    app.dependency_overrides[get_current_user] = get_current_user_with_session

    # ─── Routers ───
    app.include_router(auth.router)
    app.include_router(epos.router)
    # Demo endpoints only available in development/staging — NEVER in production
    if settings.ENVIRONMENT != "production":
        app.include_router(demo.router)
        logger.info("Demo endpoints ENABLED (non-production environment)")
    else:
        logger.info("Demo endpoints DISABLED (production environment)")
    app.include_router(team.router)
    app.include_router(email_sync.router)
    app.include_router(vendor_portal.router)
    app.include_router(exports.router)
    app.include_router(activity.router)
    app.include_router(gmail_webhook.router)
    app.include_router(attachments.router)
    app.include_router(approvals.router)
    app.include_router(notifications.router)
    app.include_router(portal.router)
    app.include_router(billing.router)
    app.include_router(builder_analytics.router)
    app.include_router(daily_reports.router)
    app.include_router(punch_list.router)
    app.include_router(budgets.router)
    app.include_router(work_orders.router)
    app.include_router(sub_payments.router)

    # ─── Health check ───
    @app.get("/api/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": settings.APP_NAME,
            "environment": settings.ENVIRONMENT,
            "build_marker": "nullpool-v24-2026-04-16",
            "ai_keys": {
                "gemini": bool(settings.GOOGLE_AI_API_KEY),
                "anthropic": bool(settings.ANTHROPIC_API_KEY),
            },
        }

    @app.get("/")
    async def root():
        return {
            "service": settings.APP_NAME,
            "version": "1.0.0",
            "docs": "/docs" if settings.ENVIRONMENT != "production" else None,
        }

    return app


app = create_app()
