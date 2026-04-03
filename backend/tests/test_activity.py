"""Tests for activity feed endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_activity_feed_requires_auth(client: AsyncClient):
    """Test that activity feed requires authentication."""
    response = await client.get("/api/activity/feed")
    assert response.status_code in (401, 403)


@pytest.mark.asyncio
async def test_activity_feed(client: AsyncClient, auth_headers, sample_epos):
    """Test activity feed returns recent EPO events."""
    response = await client.get("/api/activity/feed?days=90", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "feed" in data
    assert len(data["feed"]) > 0
    assert data["feed"][0]["type"] == "epo_created"


@pytest.mark.asyncio
async def test_today_stats(client: AsyncClient, auth_headers, sample_epos):
    """Test today's stats endpoint."""
    response = await client.get("/api/activity/stats/today", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert "today_new" in data
    assert "needs_attention" in data
