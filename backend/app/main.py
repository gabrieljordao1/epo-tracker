import logging
import time
import uuid
from contextlib import asynccontextmanager
from collections import defaultdict

from fastapi import FastAPI, Depends, Request, Response, HTTPException, status as http_status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from .core.config import get_settings
from .core.database import init_db, close_db, get_db
from .core.auth import get_current_user, decode_token, security
from .api import auth, epos, demo, team, email_sync, vendor_portal, exports, activity, gmail_webhook
from .models.models import User

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

        client_ip = request.client.host if request.client else "unknown"
        now = time.time()
        window = 60  # seconds

        # Clean old entries
        self.requests[client_ip] = [
            t for t in self.requests[client_ip] if now - t < window
        ]

        if len(self.requests[client_ip]) >= self.calls_per_minute:
            logger.warning(f"Rate limit exceeded for {client_ip} on {request.url.path}")
            return Response(
                content='{"detail":"Rate limit exceeded. Try again in a minute."}',
                status_code=429,
                media_type="application/json",
            )

        self.requests[client_ip].append(now)
        return await call_next(request)


# ─── Request Logging Middleware ─────────────────
class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = str(uuid.uuid4())[:8]
        start = time.time()

        response = await call_next(request)

        duration = round((time.time() - start) * 1000)
        logger.info(
            f"[{request_id}] {request.method} {request.url.path} → {response.status_code} ({duration}ms)"
        )

        response.headers["X-Request-ID"] = request_id
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
    # CORS — allow all origins for now (small team pilot)
    cors_origins = settings.CORS_ORIGINS
    if not cors_origins or cors_origins == ["*"]:
        cors_origins = ["*"]
    # Always include the production frontend
    production_frontend = "https://frontend-two-puce-27.vercel.app"
    if production_frontend not in cors_origins and cors_origins != ["*"]:
        cors_origins.append(production_frontend)
    logger.info(f"CORS origins configured: {cors_origins}")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Request-ID"],
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
    app.include_router(demo.router)
    app.include_router(team.router)
    app.include_router(email_sync.router)
    app.include_router(vendor_portal.router)
    app.include_router(exports.router)
    app.include_router(activity.router)
    app.include_router(gmail_webhook.router)

    # ─── Health check ───
    @app.get("/api/health")
    async def health_check():
        return {
            "status": "healthy",
            "service": settings.APP_NAME,
            "environment": settings.ENVIRONMENT,
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
