"""Tests for EPO CRUD endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_create_epo(client: AsyncClient, auth_headers):
    """Test creating a new EPO."""
    response = await client.post("/api/epos", headers=auth_headers, json={
        "vendor_name": "Test Vendor",
        "vendor_email": "test@vendor.com",
        "community": "Test Community",
        "lot_number": "42",
        "description": "Test EPO description",
        "amount": 500.00,
    })
    assert response.status_code == 200
    data = response.json()
    assert data["vendor_name"] == "Test Vendor"
    assert data["amount"] == 500.00
    assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_list_epos(client: AsyncClient, auth_headers, sample_epos):
    """Test listing EPOs for the company."""
    response = await client.get("/api/epos", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 5


@pytest.mark.asyncio
async def test_list_epos_filter_status(client: AsyncClient, auth_headers, sample_epos):
    """Test filtering EPOs by status."""
    response = await client.get("/api/epos?status_filter=pending", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert all(e["status"] == "pending" for e in data)
    assert len(data) == 2  # 2 pending EPOs in sample data


@pytest.mark.asyncio
async def test_get_single_epo(client: AsyncClient, auth_headers, sample_epos):
    """Test getting a specific EPO."""
    epo_id = sample_epos[0].id
    response = await client.get(f"/api/epos/{epo_id}", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == epo_id
    assert data["vendor_name"] is not None


@pytest.mark.asyncio
async def test_update_epo_status(client: AsyncClient, auth_headers, sample_epos):
    """Test updating an EPO status."""
    epo_id = sample_epos[0].id
    response = await client.put(f"/api/epos/{epo_id}", headers=auth_headers, json={
        "status": "confirmed",
        "confirmation_number": "PO-9999",
    })
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "confirmed"
    assert data["confirmation_number"] == "PO-9999"


@pytest.mark.asyncio
async def test_epo_not_found(client: AsyncClient, auth_headers):
    """Test getting a non-existent EPO."""
    response = await client.get("/api/epos/99999", headers=auth_headers)
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_epos_require_auth(client: AsyncClient):
    """Test that EPO endpoints require authentication."""
    response = await client.get("/api/epos")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_dashboard_stats(client: AsyncClient, auth_headers, sample_epos):
    """Test dashboard statistics endpoint."""
    response = await client.get("/api/epos/stats/dashboard", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "stats" in data
    assert data["stats"]["total_epos"] == 5
    assert data["stats"]["pending_count"] == 2
    assert data["stats"]["confirmed_count"] == 1
