"""Tests for vendor self-service portal endpoints."""

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import EPO, EPOStatus
from app.api.vendor_portal import generate_vendor_token


@pytest.fixture
async def vendor_epo(db_session: AsyncSession, test_company, test_admin) -> EPO:
    """Create an EPO with a vendor token for portal testing."""
    token = generate_vendor_token()
    epo = EPO(
        company_id=test_company.id,
        created_by_id=test_admin.id,
        vendor_name="Portal Test Vendor",
        vendor_email="vendor@test.com",
        community="Portal Park",
        lot_number="999",
        description="Test EPO for vendor portal",
        amount=500.00,
        status=EPOStatus.PENDING,
        days_open=5,
        confidence_score=0.95,
        parse_model="regex",
        vendor_token=token,
    )
    db_session.add(epo)
    await db_session.commit()
    await db_session.refresh(epo)
    return epo


@pytest.mark.asyncio
async def test_get_epo_by_token(client: AsyncClient, vendor_epo: EPO):
    """Test viewing an EPO via vendor token — no auth needed."""
    response = await client.get(f"/api/vendor/epo/{vendor_epo.vendor_token}")
    assert response.status_code == 200
    data = response.json()
    assert data["epo"]["vendor_name"] == "Portal Test Vendor"
    assert data["epo"]["amount"] == 500.00
    assert data["can_confirm"] is True
    assert data["can_dispute"] is True


@pytest.mark.asyncio
async def test_vendor_token_not_found(client: AsyncClient):
    """Test that invalid tokens return 404."""
    response = await client.get("/api/vendor/epo/invalid-token-12345")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_vendor_confirm_epo(client: AsyncClient, vendor_epo: EPO):
    """Test vendor confirming an EPO via token."""
    response = await client.post(
        f"/api/vendor/epo/{vendor_epo.vendor_token}/confirm",
        params={"confirmation_number": "PO-TEST-001"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["new_status"] == "confirmed"

    # Verify it's now confirmed
    check = await client.get(f"/api/vendor/epo/{vendor_epo.vendor_token}")
    assert check.json()["epo"]["status"] == "confirmed"
    assert check.json()["can_confirm"] is False


@pytest.mark.asyncio
async def test_vendor_dispute_epo(client: AsyncClient, vendor_epo: EPO):
    """Test vendor disputing an EPO."""
    response = await client.post(
        f"/api/vendor/epo/{vendor_epo.vendor_token}/dispute",
        params={"vendor_note": "Amount is incorrect"},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True


@pytest.mark.asyncio
async def test_cannot_confirm_already_confirmed(client: AsyncClient, vendor_epo: EPO):
    """Test that a confirmed EPO cannot be confirmed again."""
    # First confirm
    await client.post(f"/api/vendor/epo/{vendor_epo.vendor_token}/confirm")
    # Try again
    response = await client.post(f"/api/vendor/epo/{vendor_epo.vendor_token}/confirm")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_vendor_history(client: AsyncClient, vendor_epo: EPO):
    """Test vendor action history tracking."""
    # View the EPO (creates a 'viewed' action)
    await client.get(f"/api/vendor/epo/{vendor_epo.vendor_token}")

    # Check history
    response = await client.get(f"/api/vendor/epo/{vendor_epo.vendor_token}/history")
    assert response.status_code == 200
    data = response.json()
    assert len(data["history"]) >= 1
    assert data["history"][0]["action"] == "viewed"
