"""Tests for authentication endpoints."""

import pytest
from httpx import AsyncClient


@pytest.mark.asyncio
async def test_register_new_user(client: AsyncClient):
    """Test registering a new company and admin user."""
    response = await client.post("/api/auth/register", json={
        "email": "new@company.com",
        "password": "securepass123",
        "full_name": "New User",
        "company_name": "New Company LLC",
        "industry": "general",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "new@company.com"
    assert data["user"]["role"] == "admin"


@pytest.mark.asyncio
async def test_register_duplicate_email(client: AsyncClient):
    """Test that duplicate emails are rejected."""
    payload = {
        "email": "dupe@company.com",
        "password": "pass123",
        "full_name": "First User",
        "company_name": "First Co",
        "industry": "paint",
    }
    await client.post("/api/auth/register", json=payload)
    response = await client.post("/api/auth/register", json=payload)
    assert response.status_code == 400
    assert "already registered" in response.json()["detail"].lower()


@pytest.mark.asyncio
async def test_login_success(client: AsyncClient, test_admin):
    """Test successful login."""
    response = await client.post("/api/auth/login", json={
        "email": "admin@testco.com",
        "password": "testpass123",
    })
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["user"]["email"] == "admin@testco.com"


@pytest.mark.asyncio
async def test_login_wrong_password(client: AsyncClient, test_admin):
    """Test login with wrong password."""
    response = await client.post("/api/auth/login", json={
        "email": "admin@testco.com",
        "password": "wrongpassword",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_login_nonexistent_email(client: AsyncClient):
    """Test login with non-existent email."""
    response = await client.post("/api/auth/login", json={
        "email": "nobody@nowhere.com",
        "password": "anything",
    })
    assert response.status_code == 401


@pytest.mark.asyncio
async def test_get_me_authenticated(client: AsyncClient, auth_headers):
    """Test /auth/me with valid token."""
    response = await client.get("/api/auth/me", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "admin@testco.com"


@pytest.mark.asyncio
async def test_get_me_unauthenticated(client: AsyncClient):
    """Test /auth/me without token."""
    response = await client.get("/api/auth/me")
    assert response.status_code in (401, 403)
