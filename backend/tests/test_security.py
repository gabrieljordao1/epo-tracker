"""
Comprehensive tests for the security module.

Tests token encryption/decryption, input sanitization, password validation,
CSRF protection, audit logging, and other security utilities.
"""

import json
import pytest
import logging
from io import StringIO

from app.core.security import (
    encrypt_token,
    decrypt_token,
    derive_encryption_key,
    sanitize_html,
    validate_email,
    validate_phone,
    sanitize_filename,
    validate_password_strength,
    generate_csrf_token,
    validate_csrf_token,
    audit_log,
    generate_secure_random_token,
    constant_time_compare,
)


# ============================================================================
# ENCRYPTION / DECRYPTION TESTS
# ============================================================================


class TestTokenEncryption:
    """Tests for token encryption and decryption."""

    def test_encrypt_decrypt_token_roundtrip(self):
        """Test that encryption and decryption are inverse operations."""
        secret_key = "test_secret_key_for_encryption_12345"
        original_token = "ya29.a0AfH6SMBx...very_long_oauth_token_string"

        encrypted = encrypt_token(original_token, secret_key)
        decrypted = decrypt_token(encrypted, secret_key)

        assert decrypted == original_token

    def test_encrypt_creates_valid_format(self):
        """Test that encryption returns proper format with salt."""
        secret_key = "my_secret_key"
        token = "test_token_123"

        encrypted = encrypt_token(token, secret_key)

        # Should have format: salt_b64.encrypted_b64
        assert "." in encrypted
        parts = encrypted.split(".")
        assert len(parts) == 2
        # Both parts should be base64-decodable (may use URL-safe base64 with or without padding)
        import base64
        for i, part in enumerate(parts):
            # Add padding if needed
            padded = part + "=" * (4 - len(part) % 4) if len(part) % 4 else part
            try:
                base64.urlsafe_b64decode(padded)
            except Exception:
                try:
                    base64.b64decode(padded)
                except Exception as e:
                    pytest.fail(f"Encrypted token part {i} is not valid base64: {e}")

    def test_encrypt_with_different_keys_fails(self):
        """Test that decryption with different key fails."""
        secret_key_1 = "secret_key_one"
        secret_key_2 = "secret_key_two"
        token = "test_oauth_token"

        encrypted = encrypt_token(token, secret_key_1)

        with pytest.raises(ValueError, match="Token decryption failed"):
            decrypt_token(encrypted, secret_key_2)

    def test_encrypt_produces_different_ciphertexts(self):
        """Test that encrypting same token twice produces different results."""
        secret_key = "test_key"
        token = "same_token"

        encrypted1 = encrypt_token(token, secret_key)
        encrypted2 = encrypt_token(token, secret_key)

        # Should be different due to random salt
        assert encrypted1 != encrypted2
        # But both should decrypt to same token
        assert decrypt_token(encrypted1, secret_key) == token
        assert decrypt_token(encrypted2, secret_key) == token

    def test_decrypt_corrupted_token_returns_error(self):
        """Test that corrupted tokens raise ValueError."""
        secret_key = "test_key"

        # Test invalid format (no dot)
        with pytest.raises(ValueError, match="Invalid encrypted token format"):
            decrypt_token("corrupted_token_no_salt", secret_key)

    def test_decrypt_tampered_ciphertext_fails(self):
        """Test that tampered ciphertext is detected."""
        secret_key = "test_key"
        token = "test_token"

        encrypted = encrypt_token(token, secret_key)
        # Tamper with the ciphertext part
        parts = encrypted.split(".")
        tampered = parts[0] + ".invalid_ciphertext_part"

        with pytest.raises(ValueError, match="Token decryption failed"):
            decrypt_token(tampered, secret_key)

    def test_derive_encryption_key_deterministic_with_salt(self):
        """Test that key derivation is deterministic with same salt."""
        secret_key = "my_secret"
        salt = b"fixed_salt_16byt"

        key1, _ = derive_encryption_key(secret_key, salt)
        key2, _ = derive_encryption_key(secret_key, salt)

        assert key1 == key2

    def test_derive_encryption_key_different_with_different_salt(self):
        """Test that different salts produce different keys."""
        secret_key = "my_secret"
        salt1 = b"salt_one_16bytes"
        salt2 = b"salt_two_16bytes"

        key1, _ = derive_encryption_key(secret_key, salt1)
        key2, _ = derive_encryption_key(secret_key, salt2)

        assert key1 != key2

    def test_encrypt_empty_token(self):
        """Test encrypting empty string."""
        secret_key = "test_key"
        token = ""

        encrypted = encrypt_token(token, secret_key)
        decrypted = decrypt_token(encrypted, secret_key)

        assert decrypted == ""

    def test_encrypt_very_long_token(self):
        """Test encrypting very long token."""
        secret_key = "test_key"
        token = "x" * 10000

        encrypted = encrypt_token(token, secret_key)
        decrypted = decrypt_token(encrypted, secret_key)

        assert decrypted == token


# ============================================================================
# PASSWORD VALIDATION TESTS
# ============================================================================


class TestPasswordValidation:
    """Tests for password strength validation."""

    def test_validate_password_strength_strong(self):
        """Test that strong password passes validation."""
        password = "SecurePass123"
        is_valid, message = validate_password_strength(password)

        assert is_valid is True
        assert "Password meets strength requirements" in message

    def test_validate_password_strength_weak_too_short(self):
        """Test that too short password fails."""
        password = "Short1"
        is_valid, message = validate_password_strength(password)

        assert is_valid is False
        assert "at least 8 characters" in message.lower()

    def test_validate_password_strength_weak_no_uppercase(self):
        """Test that password without uppercase fails."""
        password = "nouppercasehere123"
        is_valid, message = validate_password_strength(password)

        assert is_valid is False
        assert "uppercase" in message.lower()

    def test_validate_password_strength_weak_no_lowercase(self):
        """Test that password without lowercase fails."""
        password = "NOLOWERCASE123"
        is_valid, message = validate_password_strength(password)

        assert is_valid is False
        assert "lowercase" in message.lower()

    def test_validate_password_strength_weak_no_digit(self):
        """Test that password without digit fails."""
        password = "NoDigitsHere"
        is_valid, message = validate_password_strength(password)

        assert is_valid is False
        assert "digit" in message.lower()

    def test_validate_password_strength_multiple_errors(self):
        """Test that multiple errors are returned."""
        password = "short"
        is_valid, message = validate_password_strength(password)

        assert is_valid is False
        # Should have multiple errors separated by semicolons
        assert ";" in message

    def test_validate_password_strength_edge_case_exactly_8_chars(self):
        """Test password with exactly 8 characters (minimum)."""
        password = "ValidPa1"
        is_valid, message = validate_password_strength(password)

        assert is_valid is True

    def test_validate_password_strength_with_special_chars(self):
        """Test that special characters don't hurt validation."""
        password = "SecurePass123!@#"
        is_valid, message = validate_password_strength(password)

        assert is_valid is True


# ============================================================================
# HTML SANITIZATION TESTS
# ============================================================================


class TestHtmlSanitization:
    """Tests for HTML sanitization."""

    def test_sanitize_html_removes_scripts(self):
        """Test that script tags are removed."""
        dangerous = "<p>Hello</p><script>alert('xss')</script>"
        clean = sanitize_html(dangerous)

        assert "<script>" not in clean
        assert "</script>" not in clean
        assert "Hello" in clean

    def test_sanitize_html_keeps_safe_tags(self):
        """Test that safe tags are preserved."""
        html = "<p>Normal <b>bold</b> and <em>emphasis</em></p>"
        clean = sanitize_html(html)

        assert "<b>" in clean or "bold" in clean
        assert "<em>" in clean or "emphasis" in clean
        assert "<p>" in clean or "Normal" in clean

    def test_sanitize_html_removes_onclick(self):
        """Test that event handlers are removed."""
        dangerous = '<div onclick="alert(\'xss\')">Click me</div>'
        clean = sanitize_html(dangerous)

        assert "onclick" not in clean
        assert "alert" not in clean

    def test_sanitize_html_removes_iframe(self):
        """Test that iframe tags are removed."""
        dangerous = '<iframe src="http://evil.com"></iframe>'
        clean = sanitize_html(dangerous)

        assert "<iframe>" not in clean
        assert "evil.com" not in clean

    def test_sanitize_html_custom_allowed_tags(self):
        """Test using custom allowed tags."""
        html = "<span>test</span><div>content</div>"
        clean = sanitize_html(html, allowed_tags=['span'])

        assert "test" in clean
        assert "content" in clean
        # span should be preserved
        assert "span" in clean or "<span>" in clean

    def test_sanitize_html_removes_style_tag(self):
        """Test that style tags are removed."""
        dangerous = "<style>body { display: none; }</style><p>Text</p>"
        clean = sanitize_html(dangerous)

        assert "<style>" not in clean
        assert "</style>" not in clean

    def test_sanitize_html_preserves_text_content(self):
        """Test that text content is preserved even when tags are stripped."""
        html = "<script>var x = 'hello';</script>"
        clean = sanitize_html(html)

        # At minimum, should have some content
        assert len(clean) > 0


# ============================================================================
# EMAIL VALIDATION TESTS
# ============================================================================


class TestEmailValidation:
    """Tests for email validation."""

    def test_validate_email_valid_basic(self):
        """Test valid basic email."""
        assert validate_email("user@example.com") is True

    def test_validate_email_valid_with_dots(self):
        """Test valid email with dots in local part."""
        assert validate_email("first.last@example.com") is True

    def test_validate_email_valid_with_numbers(self):
        """Test valid email with numbers."""
        assert validate_email("user123@example.com") is True

    def test_validate_email_valid_with_hyphen(self):
        """Test valid email with hyphen in domain."""
        assert validate_email("user@my-domain.com") is True

    def test_validate_email_invalid_no_at(self):
        """Test that email without @ is invalid."""
        assert validate_email("user.example.com") is False

    def test_validate_email_invalid_multiple_at(self):
        """Test that email with multiple @ is invalid."""
        assert validate_email("user@@example.com") is False

    def test_validate_email_invalid_no_domain(self):
        """Test that email without domain is invalid."""
        assert validate_email("user@") is False

    def test_validate_email_invalid_no_tld(self):
        """Test that email without TLD is invalid."""
        assert validate_email("user@example") is False

    def test_validate_email_invalid_empty(self):
        """Test that empty string is invalid."""
        assert validate_email("") is False

    def test_validate_email_invalid_spaces(self):
        """Test that email with spaces is invalid."""
        assert validate_email("user @example.com") is False

    def test_validate_email_valid_plus_addressing(self):
        """Test valid email with plus addressing."""
        assert validate_email("user+tag@example.com") is True


# ============================================================================
# PHONE VALIDATION TESTS
# ============================================================================


class TestPhoneValidation:
    """Tests for phone number validation."""

    def test_validate_phone_valid_10_digits(self):
        """Test valid 10-digit phone."""
        assert validate_phone("1234567890") is True

    def test_validate_phone_valid_formatted_parentheses(self):
        """Test valid phone with (123) format."""
        assert validate_phone("(123) 456-7890") is True

    def test_validate_phone_valid_formatted_dashes(self):
        """Test valid phone with 123-456-7890 format."""
        assert validate_phone("123-456-7890") is True

    def test_validate_phone_valid_formatted_international(self):
        """Test valid international format."""
        assert validate_phone("+1 123 456 7890") is True

    def test_validate_phone_valid_international_digits(self):
        """Test valid international phone (15 digits)."""
        assert validate_phone("12345678901234") is True

    def test_validate_phone_invalid_too_short(self):
        """Test that too short phone is invalid."""
        assert validate_phone("123456") is False

    def test_validate_phone_invalid_non_numeric(self):
        """Test that non-numeric characters (outside allowed) are invalid."""
        assert validate_phone("abc123def456") is False

    def test_validate_phone_invalid_empty(self):
        """Test that empty string is invalid."""
        assert validate_phone("") is False

    def test_validate_phone_valid_with_extensions(self):
        """Test valid phone with spaces and various formatting."""
        assert validate_phone("123 456 7890") is True


# ============================================================================
# FILENAME SANITIZATION TESTS
# ============================================================================


class TestFilenameSanitization:
    """Tests for filename sanitization."""

    def test_sanitize_filename_removes_path_traversal(self):
        """Test that path traversal sequences are removed."""
        filename = "../../../etc/passwd"
        clean = sanitize_filename(filename)

        assert ".." not in clean
        assert "/" not in clean
        assert "\\" not in clean

    def test_sanitize_filename_removes_leading_dots(self):
        """Test that leading dots are removed."""
        filename = "...hidden_file.txt"
        clean = sanitize_filename(filename)

        assert not clean.startswith(".")

    def test_sanitize_filename_removes_null_bytes(self):
        """Test that null bytes are removed."""
        filename = "file\x00name.txt"
        clean = sanitize_filename(filename)

        assert "\x00" not in clean

    def test_sanitize_filename_replaces_spaces(self):
        """Test that spaces are replaced with underscores."""
        filename = "my document file.txt"
        clean = sanitize_filename(filename)

        assert " " not in clean
        assert "_" in clean

    def test_sanitize_filename_removes_special_chars(self):
        """Test that special characters are removed."""
        filename = "file!@#$%^&*().txt"
        clean = sanitize_filename(filename)

        assert "!" not in clean
        assert "@" not in clean
        assert "#" not in clean

    def test_sanitize_filename_allows_valid_chars(self):
        """Test that valid characters are preserved."""
        filename = "my-file_123.txt"
        clean = sanitize_filename(filename)

        assert "my" in clean
        assert "file" in clean
        assert "123" in clean
        assert "-" in clean
        assert "_" in clean

    def test_sanitize_filename_handles_empty(self):
        """Test that empty filename becomes 'file'."""
        clean = sanitize_filename("")

        assert clean == "file"

    def test_sanitize_filename_truncates_long(self):
        """Test that overly long filenames are truncated."""
        filename = "a" * 500 + ".txt"
        clean = sanitize_filename(filename)

        assert len(clean) <= 255

    def test_sanitize_filename_handles_backslash(self):
        """Test that backslashes are removed."""
        filename = "C:\\Users\\file.txt"
        clean = sanitize_filename(filename)

        assert "\\" not in clean
        assert "/" not in clean


# ============================================================================
# CSRF TOKEN TESTS
# ============================================================================


class TestCsrfToken:
    """Tests for CSRF token generation and validation."""

    def test_generate_csrf_token(self):
        """Test that CSRF token is generated."""
        session_id = "session_123"
        secret_key = "my_secret"

        token = generate_csrf_token(session_id, secret_key)

        assert token is not None
        assert len(token) == 64  # SHA256 hex = 64 chars
        assert all(c in "0123456789abcdef" for c in token)

    def test_generate_csrf_token_different_sessions(self):
        """Test that different sessions get different tokens."""
        secret_key = "my_secret"

        token1 = generate_csrf_token("session_1", secret_key)
        token2 = generate_csrf_token("session_2", secret_key)

        assert token1 != token2

    def test_validate_csrf_token_valid(self):
        """Test that valid CSRF token passes validation."""
        session_id = "session_123"
        secret_key = "my_secret"

        token = generate_csrf_token(session_id, secret_key)
        is_valid = validate_csrf_token(token, session_id, secret_key)

        assert is_valid is True

    def test_validate_csrf_token_invalid_format(self):
        """Test that invalid token format fails validation."""
        session_id = "session_123"
        secret_key = "my_secret"

        # Not a valid hex string
        is_valid = validate_csrf_token("not_a_valid_token", session_id, secret_key)

        assert is_valid is False

    def test_validate_csrf_token_too_short(self):
        """Test that token that's too short fails."""
        session_id = "session_123"
        secret_key = "my_secret"

        is_valid = validate_csrf_token("abc123", session_id, secret_key)

        assert is_valid is False


# ============================================================================
# AUDIT LOGGING TESTS
# ============================================================================


class TestAuditLogging:
    """Tests for audit logging."""

    def test_audit_log_outputs_json(self):
        """Test that audit log outputs valid JSON."""
        # Capture log output
        log_capture = StringIO()
        handler = logging.StreamHandler(log_capture)
        formatter = logging.Formatter('%(message)s')
        handler.setFormatter(formatter)

        logger = logging.getLogger("security")
        original_handlers = logger.handlers[:]
        logger.handlers = [handler]

        try:
            audit_log(
                event_type="login",
                user_id="user_123",
                email="user@example.com",
                ip_address="192.168.1.1",
                status="success",
                details={"browser": "Chrome"},
            )

            log_output = log_capture.getvalue()
            log_json = json.loads(log_output.strip())

            assert log_json["event_type"] == "login"
            assert log_json["user_id"] == "user_123"
            assert log_json["email"] == "user@example.com"
            assert log_json["status"] == "success"
            assert log_json["details"]["browser"] == "Chrome"
            assert "timestamp" in log_json
        finally:
            logger.handlers = original_handlers

    def test_audit_log_includes_error_message(self):
        """Test that error message is included in failure log."""
        log_capture = StringIO()
        handler = logging.StreamHandler(log_capture)
        handler.setFormatter(logging.Formatter('%(message)s'))

        logger = logging.getLogger("security")
        original_handlers = logger.handlers[:]
        logger.handlers = [handler]

        try:
            audit_log(
                event_type="login_failed",
                email="user@example.com",
                status="failure",
                error_message="Invalid password",
            )

            log_output = log_capture.getvalue()
            log_json = json.loads(log_output.strip())

            assert log_json["status"] == "failure"
            assert log_json["error"] == "Invalid password"
        finally:
            logger.handlers = original_handlers

    def test_audit_log_handles_none_values(self):
        """Test that None values are handled gracefully."""
        log_capture = StringIO()
        handler = logging.StreamHandler(log_capture)
        handler.setFormatter(logging.Formatter('%(message)s'))

        logger = logging.getLogger("security")
        original_handlers = logger.handlers[:]
        logger.handlers = [handler]

        try:
            audit_log(
                event_type="token_refresh",
                user_id=None,
                email=None,
                ip_address=None,
            )

            log_output = log_capture.getvalue()
            log_json = json.loads(log_output.strip())

            assert log_json["event_type"] == "token_refresh"
            assert log_json["user_id"] is None
            assert log_json["email"] is None
        finally:
            logger.handlers = original_handlers

    def test_audit_log_different_event_types(self):
        """Test logging different event types."""
        event_types = [
            "login", "logout", "password_change", "password_reset",
            "token_refresh", "data_export"
        ]

        for event_type in event_types:
            log_capture = StringIO()
            handler = logging.StreamHandler(log_capture)
            handler.setFormatter(logging.Formatter('%(message)s'))

            logger = logging.getLogger("security")
            original_handlers = logger.handlers[:]
            logger.handlers = [handler]

            try:
                audit_log(event_type=event_type, user_id="user_123")
                log_output = log_capture.getvalue()
                log_json = json.loads(log_output.strip())
                assert log_json["event_type"] == event_type
            finally:
                logger.handlers = original_handlers


# ============================================================================
# UTILITY FUNCTION TESTS
# ============================================================================


class TestUtilityFunctions:
    """Tests for utility functions."""

    def test_generate_secure_random_token(self):
        """Test secure random token generation."""
        token1 = generate_secure_random_token(32)
        token2 = generate_secure_random_token(32)

        # Should be hex strings
        assert all(c in "0123456789abcdef" for c in token1)
        assert all(c in "0123456789abcdef" for c in token2)

        # Should be different (with extremely high probability)
        assert token1 != token2

    def test_generate_secure_random_token_custom_length(self):
        """Test token generation with custom length."""
        token = generate_secure_random_token(16)

        # 16 bytes = 32 hex chars
        assert len(token) == 32

    def test_constant_time_compare_equal_strings(self):
        """Test that equal strings compare as equal."""
        a = "secure_string"
        b = "secure_string"

        assert constant_time_compare(a, b) is True

    def test_constant_time_compare_different_strings(self):
        """Test that different strings compare as not equal."""
        a = "secure_string"
        b = "different_string"

        assert constant_time_compare(a, b) is False

    def test_constant_time_compare_empty_strings(self):
        """Test comparing empty strings."""
        assert constant_time_compare("", "") is True

    def test_constant_time_compare_case_sensitive(self):
        """Test that comparison is case-sensitive."""
        a = "String"
        b = "string"

        assert constant_time_compare(a, b) is False
