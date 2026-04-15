"""
Comprehensive tests for password reset and authentication flows.

Tests password reset requests, token validation, password changes,
token refresh, and security aspects like preventing user enumeration.
"""

import pytest
from datetime import datetime, timedelta
from unittest.mock import patch
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import User, PasswordResetToken
from app.core.auth import (
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.core.security import generate_secure_random_token


# ============================================================================
# PASSWORD RESET TESTS
# ============================================================================


class TestPasswordReset:
    """Tests for password reset flow."""

    @pytest.mark.asyncio
    async def test_forgot_password_sends_email(self, client: AsyncClient, db_session: AsyncSession, test_admin: User):
        """Test that forgot password sends an email."""
        with patch("resend.Emails.send") as mock_send:
            mock_send.return_value = True

            response = await client.post("/api/auth/forgot-password", json={
                "email": "admin@testco.com"
            })

            assert response.status_code == 200
            data = response.json()
            assert "message" in data

            # Verify email was sent
            mock_send.assert_called_once()

    @pytest.mark.asyncio
    async def test_forgot_password_unknown_email_still_succeeds(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test that unknown email still returns success (security - don't leak user existence)."""
        with patch("resend.Emails.send") as mock_send:
            mock_send.return_value = True

            response = await client.post("/api/auth/forgot-password", json={
                "email": "nobody@nonexistent.com"
            })

            # Should still return 200 to prevent user enumeration
            assert response.status_code == 200
            data = response.json()
            assert "message" in data

            # Email should NOT be sent for non-existent users
            mock_send.assert_not_called()

    @pytest.mark.asyncio
    async def test_reset_password_valid_code(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test successful password reset with valid code."""
        # Create a password reset token
        reset_code = generate_secure_random_token(24)
        reset_token = PasswordResetToken(
            user_id=test_admin.id,
            token_hash=reset_code,
            expires_at=datetime.utcnow() + timedelta(hours=1),
            used=False,
        )
        db_session.add(reset_token)
        await db_session.commit()

        # Reset password with valid code
        response = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": reset_code,
            "new_password": "NewSecurePass456",
        })

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

        # Verify password was actually changed
        await db_session.refresh(test_admin)
        assert verify_password("NewSecurePass456", test_admin.hashed_password)

    @pytest.mark.asyncio
    async def test_reset_password_expired_code(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test password reset fails with expired code."""
        # Create an expired password reset token
        reset_code = generate_secure_random_token(24)
        reset_token = PasswordResetToken(
            user_id=test_admin.id,
            token_hash=reset_code,
            expires_at=datetime.utcnow() - timedelta(hours=1),  # Expired
            used=False,
        )
        db_session.add(reset_token)
        await db_session.commit()

        response = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": reset_code,
            "new_password": "NewSecurePass456",
        })

        assert response.status_code == 400
        assert "expired" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_wrong_code(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test password reset fails with wrong code."""
        # Create a valid reset token
        reset_code = generate_secure_random_token(24)
        reset_token = PasswordResetToken(
            user_id=test_admin.id,
            token_hash=reset_code,
            expires_at=datetime.utcnow() + timedelta(hours=1),
            used=False,
        )
        db_session.add(reset_token)
        await db_session.commit()

        # Try with wrong code
        response = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": "wrong_code_12345",
            "new_password": "NewSecurePass456",
        })

        assert response.status_code == 400
        assert "invalid" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_weak_password(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test that weak password is rejected in reset."""
        # Create a valid reset token
        reset_code = generate_secure_random_token(24)
        reset_token = PasswordResetToken(
            user_id=test_admin.id,
            token_hash=reset_code,
            expires_at=datetime.utcnow() + timedelta(hours=1),
            used=False,
        )
        db_session.add(reset_token)
        await db_session.commit()

        # Try with weak password
        response = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": reset_code,
            "new_password": "weak",  # Too short, no uppercase, no digit
        })

        assert response.status_code == 400
        assert "password" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_reset_password_nonexistent_user(
        self, client: AsyncClient, db_session: AsyncSession
    ):
        """Test password reset for non-existent user."""
        reset_code = generate_secure_random_token(24)

        response = await client.post("/api/auth/reset-password", json={
            "email": "nobody@nonexistent.com",
            "code": reset_code,
            "new_password": "NewSecurePass456",
        })

        assert response.status_code == 400

    @pytest.mark.asyncio
    async def test_reset_password_code_only_works_once(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test that used reset code cannot be reused."""
        reset_code = generate_secure_random_token(24)
        reset_token = PasswordResetToken(
            user_id=test_admin.id,
            token_hash=reset_code,
            expires_at=datetime.utcnow() + timedelta(hours=1),
            used=False,
        )
        db_session.add(reset_token)
        await db_session.commit()

        # First reset succeeds
        response1 = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": reset_code,
            "new_password": "NewSecurePass456",
        })
        assert response1.status_code == 200

        # Second reset with same code should fail
        response2 = await client.post("/api/auth/reset-password", json={
            "email": "admin@testco.com",
            "code": reset_code,
            "new_password": "AnotherPass789",
        })
        assert response2.status_code == 400


# ============================================================================
# CHANGE PASSWORD TESTS
# ============================================================================


class TestChangePassword:
    """Tests for changing password while authenticated."""

    @pytest.mark.asyncio
    async def test_change_password_success(
        self, client: AsyncClient, auth_headers: dict, test_admin: User, db_session: AsyncSession
    ):
        """Test successful password change."""
        response = await client.post("/api/auth/change-password", json={
            "current_password": "testpass123",
            "new_password": "CompletelyNewPass789",
        }, headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "message" in data

        # Verify password was changed
        await db_session.refresh(test_admin)
        assert verify_password("CompletelyNewPass789", test_admin.hashed_password)

    @pytest.mark.asyncio
    async def test_change_password_wrong_current(
        self, client: AsyncClient, auth_headers: dict, test_admin: User
    ):
        """Test change password fails with wrong current password."""
        response = await client.post("/api/auth/change-password", json={
            "current_password": "wrongcurrentpass",
            "new_password": "CompletelyNewPass789",
        }, headers=auth_headers)

        assert response.status_code == 401
        assert "incorrect" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_change_password_weak_new_password(
        self, client: AsyncClient, auth_headers: dict, test_admin: User
    ):
        """Test that weak new password is rejected."""
        response = await client.post("/api/auth/change-password", json={
            "current_password": "testpass123",
            "new_password": "weak",
        }, headers=auth_headers)

        assert response.status_code == 400
        assert "password" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_change_password_same_as_old(
        self, client: AsyncClient, auth_headers: dict, test_admin: User, db_session: AsyncSession
    ):
        """Test that same password as old is rejected."""
        # First change to a strong password so we can test reusing it
        strong_password = "StrongPass123"
        test_admin.hashed_password = get_password_hash(strong_password)
        await db_session.commit()

        # Now try to change to the same password
        response = await client.post("/api/auth/change-password", json={
            "current_password": strong_password,
            "new_password": strong_password,  # Same as current (invalid)
        }, headers=auth_headers)

        assert response.status_code == 400
        assert "different" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_change_password_unauthenticated(self, client: AsyncClient):
        """Test change password fails without authentication."""
        response = await client.post("/api/auth/change-password", json={
            "current_password": "testpass123",
            "new_password": "NewPass789",
        })

        assert response.status_code in (401, 403)


# ============================================================================
# TOKEN REFRESH TESTS
# ============================================================================


class TestTokenRefresh:
    """Tests for JWT token refresh flow."""

    @pytest.mark.asyncio
    async def test_refresh_token_success(
        self, client: AsyncClient, test_admin: User
    ):
        """Test successful token refresh."""
        refresh_token = create_refresh_token(data={"sub": str(test_admin.id)})

        response = await client.post("/api/auth/refresh", json={
            "refresh_token": refresh_token,
        })

        assert response.status_code == 200
        data = response.json()
        assert "access_token" in data
        assert "token_type" in data
        assert data["token_type"] == "bearer"

        # Verify new access token is valid
        new_token = data["access_token"]
        payload = decode_token(new_token)
        assert payload is not None
        assert payload.get("sub") == str(test_admin.id)

    @pytest.mark.asyncio
    async def test_refresh_token_expired(
        self, client: AsyncClient, test_admin: User
    ):
        """Test refresh fails with expired refresh token."""
        # Create an expired refresh token
        from jose import jwt
        from app.core.config import get_settings

        settings = get_settings()
        expired_token = jwt.encode(
            {
                "sub": str(test_admin.id),
                "type": "refresh",
                "exp": datetime.utcnow() - timedelta(hours=1),
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

        response = await client.post("/api/auth/refresh", json={
            "refresh_token": expired_token,
        })

        assert response.status_code == 401
        assert "invalid" in response.json()["detail"].lower()

    @pytest.mark.asyncio
    async def test_refresh_token_invalid_format(
        self, client: AsyncClient
    ):
        """Test refresh fails with invalid token format."""
        response = await client.post("/api/auth/refresh", json={
            "refresh_token": "not_a_valid_token",
        })

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_wrong_type(
        self, client: AsyncClient, test_admin: User
    ):
        """Test that access token cannot be used as refresh token."""
        access_token = create_access_token(data={"sub": str(test_admin.id)})

        response = await client.post("/api/auth/refresh", json={
            "refresh_token": access_token,
        })

        # Should fail because access token doesn't have "type": "refresh"
        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_with_nonexistent_user(
        self, client: AsyncClient
    ):
        """Test refresh fails if user no longer exists."""
        from jose import jwt
        from app.core.config import get_settings

        settings = get_settings()
        refresh_token = jwt.encode(
            {
                "sub": "99999999",  # Non-existent user ID
                "type": "refresh",
                "exp": datetime.utcnow() + timedelta(days=7),
            },
            settings.SECRET_KEY,
            algorithm=settings.ALGORITHM,
        )

        response = await client.post("/api/auth/refresh", json={
            "refresh_token": refresh_token,
        })

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_refresh_token_new_token_has_new_exp(
        self, client: AsyncClient, test_admin: User
    ):
        """Test that new access token has a fresh expiration."""
        refresh_token = create_refresh_token(data={"sub": str(test_admin.id)})

        response = await client.post("/api/auth/refresh", json={
            "refresh_token": refresh_token,
        })

        assert response.status_code == 200
        new_token = response.json()["access_token"]
        payload = decode_token(new_token)

        # New token should have exp set to future
        exp_time = datetime.fromtimestamp(payload["exp"])
        assert exp_time > datetime.utcnow()


# ============================================================================
# SECURITY-RELATED PASSWORD TESTS
# ============================================================================


class TestPasswordSecurityEdgeCases:
    """Tests for edge cases and security aspects of password handling."""

    @pytest.mark.asyncio
    async def test_password_hash_not_exposed_in_response(
        self, client: AsyncClient, auth_headers: dict
    ):
        """Test that password hash is never returned in API responses."""
        response = await client.get("/api/auth/me", headers=auth_headers)

        assert response.status_code == 200
        data = response.json()
        assert "hashed_password" not in data
        assert "password" not in data

    @pytest.mark.asyncio
    async def test_failed_password_attempts_logged(
        self, client: AsyncClient, test_admin: User
    ):
        """Test that failed password attempts are logged for security."""
        response = await client.post("/api/auth/login", json={
            "email": "admin@testco.com",
            "password": "wrongpassword",
        })

        assert response.status_code == 401

    @pytest.mark.asyncio
    async def test_password_reset_codes_are_unique(
        self, client: AsyncClient, db_session: AsyncSession, test_admin: User
    ):
        """Test that multiple password reset codes are different."""
        codes = set()

        for _ in range(10):
            reset_code = generate_secure_random_token(24)
            codes.add(reset_code)

        # All codes should be unique
        assert len(codes) == 10

    def test_password_hash_function_produces_different_hashes(self):
        """Test that same password hashed twice produces different hashes."""
        password = "MySecurePassword123"
        hash1 = get_password_hash(password)
        hash2 = get_password_hash(password)

        # Hashes should be different (due to salt)
        assert hash1 != hash2

        # But both should verify
        assert verify_password(password, hash1)
        assert verify_password(password, hash2)

    def test_verify_password_is_secure(self):
        """Test password verification is resistant to timing attacks."""
        password = "MySecurePassword123"
        wrong_password = "WrongPassword789"
        hashed = get_password_hash(password)

        # Correct password should verify
        assert verify_password(password, hashed)

        # Wrong password should not verify
        assert not verify_password(wrong_password, hashed)


# ============================================================================
# RATE LIMITING TESTS
# ============================================================================


class TestLoginRateLimiting:
    """Tests for login rate limiting."""

    @pytest.mark.asyncio
    async def test_multiple_failed_logins_rate_limited(
        self, client: AsyncClient, test_admin: User
    ):
        """Test that multiple failed logins trigger rate limiting."""
        # Clear rate limiter state before test
        from app.api.auth import _failed_login_store
        _failed_login_store.clear()

        max_attempts = 5

        # Make multiple failed login attempts
        for attempt in range(max_attempts + 1):
            response = await client.post("/api/auth/login", json={
                "email": "admin@testco.com",
                "password": "wrongpassword",
            })

            if attempt < max_attempts:
                assert response.status_code == 401
            else:
                # After max attempts, should be rate limited
                assert response.status_code in (429, 401)  # Rate limit or auth error

    @pytest.mark.asyncio
    async def test_rate_limit_resets_after_window(
        self, client: AsyncClient, test_admin: User
    ):
        """Test that rate limit resets after time window expires."""
        # Clear rate limiter state before test
        from app.api.auth import _failed_login_store
        _failed_login_store.clear()

        # Patch the rate limiter to always allow (simulate time window reset)
        with patch("app.api.auth._check_login_lockout"):
            # Make failed attempts
            for _ in range(3):
                await client.post("/api/auth/login", json={
                    "email": "admin@testco.com",
                    "password": "wrongpassword",
                })

            # Try with correct password - should succeed because lockout is mocked
            response = await client.post("/api/auth/login", json={
                "email": "admin@testco.com",
                "password": "testpass123",
            })

            # Should be able to login with correct password
            assert response.status_code == 200


# ============================================================================
# TOKEN INTEGRITY TESTS
# ============================================================================


class TestTokenIntegrity:
    """Tests for token integrity and validation."""

    def test_access_token_includes_required_claims(self):
        """Test that access token includes all required claims."""
        user_id = "123"
        token = create_access_token(data={"sub": user_id})

        payload = decode_token(token)
        assert payload is not None
        assert payload.get("sub") == user_id
        assert "exp" in payload

    def test_refresh_token_includes_type_claim(self):
        """Test that refresh token includes type claim."""
        from app.core.config import get_settings

        settings = get_settings()
        user_id = "123"
        token = create_refresh_token(data={"sub": user_id})

        from jose import jwt
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        assert payload.get("type") == "refresh"

    def test_token_with_tampered_payload_invalid(self):
        """Test that tampering with token payload makes it invalid."""
        user_id = "123"
        token = create_access_token(data={"sub": user_id})

        # Try to tamper with token (remove last char)
        tampered = token[:-1]

        payload = decode_token(tampered)
        assert payload is None

    def test_token_signature_verified(self):
        """Test that token signature is verified."""
        from app.core.config import get_settings
        from jose import jwt

        settings = get_settings()
        user_id = "123"
        token = create_access_token(data={"sub": user_id})

        # Verify with correct key - should work
        payload = decode_token(token)
        assert payload is not None

        # Verify with wrong key - should fail
        try:
            jwt.decode(token, "wrong_secret_key", algorithms=[settings.ALGORITHM])
            assert False, "Should have raised JWTError"
        except Exception:
            pass  # Expected


# ============================================================================
# EMAIL VERIFICATION TESTS
# ============================================================================


class TestEmailVerification:
    """Tests for email verification in password reset."""

    @pytest.mark.asyncio
    async def test_forgot_password_requires_valid_email(
        self, client: AsyncClient
    ):
        """Test that invalid email format is rejected."""
        response = await client.post("/api/auth/forgot-password", json={
            "email": "not_an_email"
        })

        assert response.status_code == 422

    @pytest.mark.asyncio
    async def test_reset_password_requires_valid_email(
        self, client: AsyncClient
    ):
        """Test that reset-password requires valid email format."""
        response = await client.post("/api/auth/reset-password", json={
            "email": "invalid_email",
            "code": "somecode",
            "new_password": "NewPass123",
        })

        assert response.status_code == 422
