"""Tests for team management endpoints — validates multi-tenant security."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import get_password_hash, create_access_token
from app.models.models import Company, User, UserRole, Industry, PlanTier, EPO, EPOStatus, CommunityAssignment


@pytest.mark.asyncio
async def test_team_members_require_auth(client: AsyncClient):
    """Team endpoint must require authentication."""
    response = await client.get("/api/team/members")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_team_members_returns_own_company(client: AsyncClient, auth_headers, test_admin, test_field_user):
    """Team endpoint should return members from own company only."""
    response = await client.get("/api/team/members", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["total"] >= 1
    # All members should belong to test company
    emails = [m["email"] for m in data["members"]]
    assert "admin@testco.com" in emails


@pytest.mark.asyncio
async def test_team_members_isolation(client: AsyncClient, db_session: AsyncSession, test_admin):
    """Users from company B should NOT see company A's team members."""
    # Create a second company with a user
    company_b = Company(name="Other Company", industry=Industry.GENERAL, plan_tier=PlanTier.STARTER)
    db_session.add(company_b)
    await db_session.flush()

    user_b = User(
        company_id=company_b.id,
        email="userb@otherco.com",
        full_name="User B",
        hashed_password=get_password_hash("pass123"),
        role=UserRole.ADMIN,
    )
    db_session.add(user_b)
    await db_session.commit()
    await db_session.refresh(user_b)

    # Get token for user B
    token_b = create_access_token(data={"sub": str(user_b.id)})
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # User B should only see their own company's members
    response = await client.get("/api/team/members", headers=headers_b)
    assert response.status_code == 200
    data = response.json()

    emails = [m["email"] for m in data["members"]]
    assert "userb@otherco.com" in emails
    # CRITICAL: Must NOT see company A's users
    assert "admin@testco.com" not in emails
    assert "field@testco.com" not in emails
