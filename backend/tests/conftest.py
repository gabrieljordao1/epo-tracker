"""
Shared test fixtures for the EPO Tracker test suite.
Uses an in-memory SQLite database for fast, isolated tests.
"""

import pytest
import asyncio
from typing import AsyncGenerator
from httpx import AsyncClient, ASGITransport

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database import Base, get_db
from app.main import create_app
from app.core.auth import get_password_hash, create_access_token
from app.models.models import Company, User, EPO, CommunityAssignment, UserRole, Industry, PlanTier, EPOStatus


# ─── Test Database ────────────────────────────────
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
    echo=False,
)

TestSessionLocal = async_sessionmaker(
    test_engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


# ─── Fixtures ─────────────────────────────────────

@pytest.fixture(scope="session")
def event_loop():
    """Create event loop for the test session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


@pytest.fixture(autouse=True)
async def setup_db():
    """Create tables before each test, drop after."""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


@pytest.fixture
async def db_session() -> AsyncGenerator[AsyncSession, None]:
    """Get a fresh database session for each test."""
    async with TestSessionLocal() as session:
        yield session


@pytest.fixture
async def app():
    """Create a test FastAPI app with overridden DB dependency."""
    _app = create_app()

    async def override_get_db():
        async with TestSessionLocal() as session:
            yield session

    _app.dependency_overrides[get_db] = override_get_db
    return _app


@pytest.fixture
async def client(app) -> AsyncGenerator[AsyncClient, None]:
    """Async HTTP client for testing API endpoints."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def test_company(db_session: AsyncSession) -> Company:
    """Create a test company."""
    company = Company(
        name="Test Painting Co",
        industry=Industry.PAINT,
        plan_tier=PlanTier.PRO,
    )
    db_session.add(company)
    await db_session.commit()
    await db_session.refresh(company)
    return company


@pytest.fixture
async def test_admin(db_session: AsyncSession, test_company: Company) -> User:
    """Create a test admin user."""
    user = User(
        company_id=test_company.id,
        email="admin@testco.com",
        full_name="Test Admin",
        hashed_password=get_password_hash("testpass123"),
        role=UserRole.ADMIN,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
async def test_field_user(db_session: AsyncSession, test_company: Company) -> User:
    """Create a test field supervisor."""
    user = User(
        company_id=test_company.id,
        email="field@testco.com",
        full_name="Field Supervisor",
        hashed_password=get_password_hash("testpass123"),
        role=UserRole.FIELD,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    # Assign communities
    for comm in ["Community A", "Community B"]:
        assignment = CommunityAssignment(
            company_id=test_company.id,
            supervisor_id=user.id,
            community_name=comm,
        )
        db_session.add(assignment)
    await db_session.commit()

    return user


@pytest.fixture
async def admin_token(test_admin: User) -> str:
    """Get a valid JWT token for the admin user."""
    return create_access_token(data={"sub": str(test_admin.id)})


@pytest.fixture
async def field_token(test_field_user: User) -> str:
    """Get a valid JWT token for the field user."""
    return create_access_token(data={"sub": str(test_field_user.id)})


@pytest.fixture
async def auth_headers(admin_token: str) -> dict:
    """Auth headers for admin user."""
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture
async def sample_epos(db_session: AsyncSession, test_company: Company, test_admin: User) -> list:
    """Create sample EPOs for testing."""
    epos = []
    test_data = [
        ("Summit Builders", "epo@summit.com", "Community A", "101", 285.00, EPOStatus.PENDING, 3),
        ("DRB Homes", "sub@drb.com", "Community B", "202", 720.00, EPOStatus.CONFIRMED, 6),
        ("Ryan Homes", "epo@ryan.com", "Community A", "303", 450.00, EPOStatus.PENDING, 8),
        ("K. Hovnanian", "extra@khov.com", "Community B", "404", 165.00, EPOStatus.DENIED, 12),
        ("Meritage", "orders@meritage.com", "Community A", "505", 890.00, EPOStatus.DISCOUNT, 2),
    ]

    for vendor, email, comm, lot, amount, status, days in test_data:
        epo = EPO(
            company_id=test_company.id,
            created_by_id=test_admin.id,
            vendor_name=vendor,
            vendor_email=email,
            community=comm,
            lot_number=lot,
            description=f"Test EPO for {vendor}",
            amount=amount,
            status=status,
            days_open=days,
            confidence_score=0.92,
            parse_model="regex",
            synced_from_email=True,
        )
        db_session.add(epo)
        epos.append(epo)

    await db_session.commit()
    for epo in epos:
        await db_session.refresh(epo)
    return epos
