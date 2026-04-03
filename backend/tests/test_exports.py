"""Tests for export endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_export_csv_requires_auth(client: AsyncClient):
    """Test that CSV export requires authentication."""
    response = await client.get("/api/exports/epos/csv")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_export_csv(client: AsyncClient, auth_headers, sample_epos):
    """Test CSV export returns valid CSV content."""
    response = await client.get("/api/exports/epos/csv", headers=auth_headers)
    assert response.status_code == 200
    assert "text/csv" in response.headers["content-type"]
    assert "attachment" in response.headers.get("content-disposition", "")

    # Verify CSV has header + data rows
    lines = response.text.strip().split("\n")
    assert len(lines) == 6  # 1 header + 5 sample EPOs
    assert "Vendor" in lines[0]


@pytest.mark.asyncio
async def test_export_csv_with_status_filter(client: AsyncClient, auth_headers, sample_epos):
    """Test CSV export with status filter."""
    response = await client.get(
        "/api/exports/epos/csv?status_filter=pending",
        headers=auth_headers,
    )
    assert response.status_code == 200
    lines = response.text.strip().split("\n")
    assert len(lines) == 3  # 1 header + 2 pending EPOs


@pytest.mark.asyncio
async def test_export_summary(client: AsyncClient, auth_headers, sample_epos):
    """Test summary export returns structured data."""
    response = await client.get("/api/exports/epos/summary?days=90", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["overview"]["total"] == 5
    assert data["overview"]["confirmed"] == 1
    assert len(data["by_vendor"]) > 0
    assert len(data["by_community"]) > 0
