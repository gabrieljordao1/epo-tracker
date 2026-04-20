"""Tests for slowapi rate limiting.

These tests create a dedicated app instance with rate limiting ENABLED
(overriding the test-mode bypass) to verify limits are enforced correctly.
"""

import pytest
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.auth import get_password_hash, create_access_token
from app.main import create_app
from app.core.rate_limit import limiter
from app.models.models import Company, User, UserRole, Industry, PlanTier

from tests.conftest import TestSessionLocal, test_engine
from app.core.database import Base


@pytest.fixture(autouse=True)
async def setup_rate_limit_db():
    """Create tables before each test, drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def rate_limited_app():
    """Create app with rate limiting explicitly enabled."""
    _app = create_app()

    async def override_get_db():
        async with TestSessionLocal() as session:
            yield session

    _app.dependency_overrides[get_db] = override_get_db

    # Force-enable the limiter for these tests
    limiter.enabled = True
    yield _app
    # Reset to avoid affecting other tests
    limiter.enabled = False


@pytest.fixture
async def rate_limited_client(rate_limited_app) -> AsyncClient:
    """Client that enforces rate limits."""
    transport = ASGITransport(app=rate_limited_app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def test_user_for_rate_limit():
    """Create a test user directly in DB for rate limit tests."""
    async with TestSessionLocal() as session:
        company = Company(
            name="Rate Limit Test Co",
            industry=Industry.PAINT,
            plan_tier=PlanTier.PRO,
        )
        session.add(company)
        await session.commit()
        await session.refresh(company)

        user = User(
            company_id=company.id,
            email="ratelimit@test.com",
            full_name="Rate Limit User",
            hashed_password=get_password_hash("TestPass123"),
            role=UserRole.ADMIN,
        )
        session.add(user)
        await session.commit()
        await session.refresh(user)
        return user


# ─── Login rate limit tests ──────────────────────


@pytest.mark.asyncio
async def test_login_rate_limit_blocks_on_6th_attempt(
    rate_limited_client: AsyncClient,
    test_user_for_rate_limit: User,
):
    """Hitting /login 6 times in a minute returns 429 on the 6th."""
    # Clear any previous rate limit state
    limiter.reset()

    payload = {"email": "ratelimit@test.com", "password": "TestPass123"}

    # First 5 attempts should succeed (200)
    for i in range(5):
        response = await rate_limited_client.post("/api/auth/login", json=payload)
        assert response.status_code == 200, (
            f"Attempt {i+1} failed with {response.status_code}: {response.text}"
        )

    # 6th attempt should be rate limited (429)
    response = await rate_limited_client.post("/api/auth/login", json=payload)
    assert response.status_code == 429, (
        f"Expected 429 on 6th attempt, got {response.status_code}: {response.text}"
    )
    data = response.json()
    assert "rate limit" in data["detail"].lower() or "retry" in data["detail"].lower()


# ─── Forgot password rate limit tests ────────────


@pytest.mark.asyncio
async def test_forgot_password_rate_limit_blocks_on_4th_attempt(
    rate_limited_client: AsyncClient,
):
    """Hitting /forgot-password 4 times in an hour returns 429 on the 4th."""
    limiter.reset()

    payload = {"email": "anyone@example.com"}

    # First 3 attempts should succeed (returns 200 regardless of user existence)
    for i in range(3):
        response = await rate_limited_client.post(
            "/api/auth/forgot-password", json=payload
        )
        assert response.status_code == 200, (
            f"Attempt {i+1} failed with {response.status_code}: {response.text}"
        )

    # 4th attempt should be rate limited
    response = await rate_limited_client.post(
        "/api/auth/forgot-password", json=payload
    )
    assert response.status_code == 429, (
        f"Expected 429 on 4th attempt, got {response.status_code}: {response.text}"
    )


# ─── Per-IP isolation tests ─────────────────────


@pytest.mark.asyncio
async def test_rate_limits_are_per_ip(
    rate_limited_app,
    test_user_for_rate_limit: User,
):
    """Two different IPs each get their own rate limit budget."""
    limiter.reset()

    payload = {"email": "ratelimit@test.com", "password": "TestPass123"}

    transport = ASGITransport(app=rate_limited_app)

    # Client A (IP: 10.0.0.1)
    async with AsyncClient(transport=transport, base_url="http://test") as client_a:
        # Exhaust Client A's budget (5 requests)
        for i in range(5):
            response = await client_a.post(
                "/api/auth/login",
                json=payload,
                headers={"X-Forwarded-For": "10.0.0.1"},
            )
            assert response.status_code == 200, f"Client A attempt {i+1} failed"

        # Client A's 6th should be blocked
        response = await client_a.post(
            "/api/auth/login",
            json=payload,
            headers={"X-Forwarded-For": "10.0.0.1"},
        )
        assert response.status_code == 429, "Client A should be rate limited"

    # Client B (IP: 10.0.0.2) should still have its full budget
    async with AsyncClient(transport=transport, base_url="http://test") as client_b:
        response = await client_b.post(
            "/api/auth/login",
            json=payload,
            headers={"X-Forwarded-For": "10.0.0.2"},
        )
        assert response.status_code == 200, (
            f"Client B should NOT be rate limited, got {response.status_code}"
        )


# ─── Success doesn't reset rate limit ───────────


@pytest.mark.asyncio
async def test_successful_login_does_not_reset_rate_limit(
    rate_limited_client: AsyncClient,
    test_user_for_rate_limit: User,
):
    """Rate limits are per-attempt, not per-success. A successful login
    doesn't give you more attempts."""
    limiter.reset()

    payload = {"email": "ratelimit@test.com", "password": "TestPass123"}

    # Make 5 successful logins
    for i in range(5):
        response = await rate_limited_client.post("/api/auth/login", json=payload)
        assert response.status_code == 200, f"Attempt {i+1} should succeed"

    # Even though all 5 were successful, the 6th should still be blocked
    response = await rate_limited_client.post("/api/auth/login", json=payload)
    assert response.status_code == 429, (
        "6th attempt should be rate limited even after 5 successes"
    )
