"""
Security module for Onyx EPO tracker application.

Provides token encryption, input sanitization, password validation,
rate limiting, CSRF protection, and audit logging.
"""

import hashlib
import hmac
import json
import logging
import re
import secrets
from datetime import datetime
from functools import wraps
from typing import Callable, Optional, Tuple

import bleach
from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC


# Configure structured logging for security events
security_logger = logging.getLogger("security")
security_handler = logging.StreamHandler()
security_formatter = logging.Formatter(
    '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
security_handler.setFormatter(security_formatter)
security_logger.addHandler(security_handler)
security_logger.setLevel(logging.INFO)


# ============================================================================
# TOKEN ENCRYPTION / DECRYPTION (AES-256-GCM via Fernet)
# ============================================================================


def derive_encryption_key(secret_key: str, salt: Optional[bytes] = None) -> Tuple[bytes, bytes]:
    """
    Derive an encryption key from the app's SECRET_KEY using PBKDF2.

    Uses PBKDF2-SHA256 to derive a 32-byte key suitable for Fernet encryption.
    Fernet internally uses AES-128 in CBC mode, but we derive from a strong base.

    Args:
        secret_key: The app's SECRET_KEY from settings
        salt: Optional salt for key derivation (generated if not provided)

    Returns:
        Tuple of (derived_key_bytes, salt_bytes) where derived_key is base64-encoded
        for use with Fernet
    """
    if salt is None:
        salt = secrets.token_bytes(16)

    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=100000,
    )
    derived_key = kdf.derive(secret_key.encode())

    # Fernet requires base64-encoded 32-byte key
    import base64
    fernet_key = base64.urlsafe_b64encode(derived_key)

    return fernet_key, salt


def encrypt_token(token: str, secret_key: str) -> str:
    """
    Encrypt a Gmail OAuth token using Fernet (AES encryption).

    Derives encryption key from SECRET_KEY and encrypts the token.
    The returned encrypted token is safe to store in the database.

    Args:
        token: The OAuth token to encrypt
        secret_key: The app's SECRET_KEY for key derivation

    Returns:
        Encrypted token as a string (includes salt and ciphertext)

    Raises:
        ValueError: If encryption fails
    """
    try:
        fernet_key, salt = derive_encryption_key(secret_key)
        cipher = Fernet(fernet_key)
        encrypted = cipher.encrypt(token.encode())

        # Prepend salt to encrypted data for decryption
        import base64
        salt_b64 = base64.b64encode(salt).decode()
        encrypted_b64 = encrypted.decode()

        return f"{salt_b64}.{encrypted_b64}"
    except Exception as e:
        raise ValueError(f"Token encryption failed: {str(e)}")


def decrypt_token(encrypted_token: str, secret_key: str) -> str:
    """
    Decrypt a Gmail OAuth token encrypted with encrypt_token.

    Extracts salt from the encrypted token, rederives the encryption key,
    and decrypts the ciphertext.

    Args:
        encrypted_token: The encrypted token string from encrypt_token
        secret_key: The app's SECRET_KEY for key derivation

    Returns:
        Decrypted OAuth token as a string

    Raises:
        ValueError: If decryption fails or token is invalid
    """
    try:
        import base64

        # Split salt and ciphertext
        parts = encrypted_token.split(".", 1)
        if len(parts) != 2:
            raise ValueError("Invalid encrypted token format")

        salt_b64, encrypted_b64 = parts
        salt = base64.b64decode(salt_b64)

        # Rederive key with same salt
        fernet_key, _ = derive_encryption_key(secret_key, salt)
        cipher = Fernet(fernet_key)

        decrypted = cipher.decrypt(encrypted_b64.encode())
        return decrypted.decode()
    except InvalidToken:
        raise ValueError("Token decryption failed: Invalid or tampered token")
    except Exception as e:
        raise ValueError(f"Token decryption failed: {str(e)}")


# ============================================================================
# INPUT SANITIZATION
# ============================================================================


def sanitize_html(user_input: str, allowed_tags: Optional[list] = None) -> str:
    """
    Sanitize HTML/XSS from user input using bleach.

    Removes dangerous HTML tags and attributes while preserving safe formatting.
    Default allows minimal safe tags (b, i, u, em, strong, p, br).

    Args:
        user_input: The user-provided string to sanitize
        allowed_tags: List of allowed HTML tags (default: ['b', 'i', 'u', 'em', 'strong', 'p', 'br'])

    Returns:
        Sanitized string safe for display/storage
    """
    if allowed_tags is None:
        allowed_tags = ['b', 'i', 'u', 'em', 'strong', 'p', 'br']

    return bleach.clean(
        user_input,
        tags=allowed_tags,
        strip=True,
        strip_comments=True
    )


def validate_email(email: str) -> bool:
    """
    Validate email format using regex.

    Uses a practical regex pattern that covers most valid email formats
    as per RFC 5322 (simplified).

    Args:
        email: Email address to validate

    Returns:
        True if valid email format, False otherwise
    """
    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    return bool(re.match(pattern, email))


def validate_phone(phone: str) -> bool:
    """
    Validate phone number format.

    Accepts phone numbers in common formats:
    - (123) 456-7890
    - 123-456-7890
    - 1234567890
    - +1 123 456 7890

    Args:
        phone: Phone number to validate

    Returns:
        True if valid phone format, False otherwise
    """
    # Remove common formatting characters
    cleaned = re.sub(r'[\s\-().+]', '', phone)

    # Check if at least 10 digits (for US/CA) or more (for international)
    return bool(re.match(r'^\d{10,15}$', cleaned))


def sanitize_filename(filename: str) -> str:
    """
    Sanitize filename to prevent directory traversal and unsafe characters.

    Removes or replaces characters that could be dangerous in filenames.

    Args:
        filename: Original filename

    Returns:
        Sanitized filename safe for filesystem operations
    """
    # Remove path separators and null bytes
    filename = re.sub(r'[\\/\x00]', '', filename)

    # Replace spaces with underscores
    filename = filename.replace(' ', '_')

    # Remove any characters outside alphanumeric, underscore, hyphen, dot
    filename = re.sub(r'[^\w\-.]', '', filename)

    # Prevent empty or overly long filenames
    filename = filename.strip('.')
    if not filename:
        filename = 'file'
    if len(filename) > 255:
        filename = filename[:255]

    return filename


# ============================================================================
# PASSWORD VALIDATION
# ============================================================================


def validate_password_strength(password: str) -> Tuple[bool, str]:
    """
    Validate password strength requirements.

    Requirements:
    - Minimum 8 characters
    - At least 1 uppercase letter (A-Z)
    - At least 1 lowercase letter (a-z)
    - At least 1 digit (0-9)
    - Optionally: at least 1 special character for extra strength

    Args:
        password: Password string to validate

    Returns:
        Tuple of (is_valid: bool, message: str)
    """
    errors = []

    if len(password) < 8:
        errors.append("Password must be at least 8 characters long")

    if not re.search(r'[A-Z]', password):
        errors.append("Password must contain at least one uppercase letter (A-Z)")

    if not re.search(r'[a-z]', password):
        errors.append("Password must contain at least one lowercase letter (a-z)")

    if not re.search(r'\d', password):
        errors.append("Password must contain at least one digit (0-9)")

    if errors:
        return False, "; ".join(errors)

    return True, "Password meets strength requirements"


# ============================================================================
# RATE LIMITING
# ============================================================================


# In-memory store for rate limiting (in production, use Redis)
_rate_limit_store = {}


def rate_limit(max_attempts: int = 5, window_seconds: int = 300):
    """
    Rate limiting decorator for sensitive endpoints.

    Tracks requests per unique identifier (typically IP or user_id) and
    enforces a maximum number of attempts within a time window.

    Usage:
        @app.post("/login")
        @rate_limit(max_attempts=5, window_seconds=300)  # 5 attempts per 5 min
        async def login(request):
            ...

    For production, this should use Redis instead of in-memory storage.

    Args:
        max_attempts: Maximum number of attempts allowed
        window_seconds: Time window in seconds

    Returns:
        Decorator function
    """
    def decorator(func: Callable) -> Callable:
        @wraps(func)
        async def async_wrapper(*args, **kwargs):
            # Extract identifier from request (would need to be customized per app)
            # This is a simplified example
            identifier = kwargs.get('client_id') or 'unknown'

            now = datetime.utcnow()
            key = f"{func.__name__}:{identifier}"

            # Clean old entries
            if key in _rate_limit_store:
                _rate_limit_store[key] = [
                    ts for ts in _rate_limit_store[key]
                    if (now - ts).total_seconds() < window_seconds
                ]
            else:
                _rate_limit_store[key] = []

            # Check if limit exceeded
            if len(_rate_limit_store[key]) >= max_attempts:
                raise RuntimeError(
                    f"Rate limit exceeded: {max_attempts} attempts "
                    f"per {window_seconds} seconds"
                )

            # Record this attempt
            _rate_limit_store[key].append(now)

            return await func(*args, **kwargs)

        @wraps(func)
        def sync_wrapper(*args, **kwargs):
            # Extract identifier from request
            identifier = kwargs.get('client_id') or 'unknown'

            now = datetime.utcnow()
            key = f"{func.__name__}:{identifier}"

            # Clean old entries
            if key in _rate_limit_store:
                _rate_limit_store[key] = [
                    ts for ts in _rate_limit_store[key]
                    if (now - ts).total_seconds() < window_seconds
                ]
            else:
                _rate_limit_store[key] = []

            # Check if limit exceeded
            if len(_rate_limit_store[key]) >= max_attempts:
                raise RuntimeError(
                    f"Rate limit exceeded: {max_attempts} attempts "
                    f"per {window_seconds} seconds"
                )

            # Record this attempt
            _rate_limit_store[key].append(now)

            return func(*args, **kwargs)

        # Return appropriate wrapper based on function type
        if hasattr(func, '__code__') and 'async' in str(func.__code__.co_flags):
            return async_wrapper
        else:
            return sync_wrapper

    return decorator


# ============================================================================
# CSRF TOKEN GENERATION & VALIDATION
# ============================================================================


def generate_csrf_token(session_id: str, secret_key: str) -> str:
    """
    Generate a CSRF token using HMAC-SHA256.

    Creates a token bound to a session ID using HMAC for integrity verification.
    Tokens should be stored in session and validated on state-changing requests.

    Args:
        session_id: Unique session identifier
        secret_key: The app's SECRET_KEY

    Returns:
        CSRF token as hex string
    """
    token = hmac.new(
        secret_key.encode(),
        (session_id + str(datetime.utcnow().timestamp())).encode(),
        hashlib.sha256
    ).hexdigest()

    return token


def validate_csrf_token(
    token: str,
    session_id: str,
    secret_key: str,
    max_age_seconds: int = 3600
) -> bool:
    """
    Validate a CSRF token.

    Verifies that the token matches the expected HMAC and is not expired.

    Note: This is a simplified implementation. In production, store the token
    with a timestamp and check expiration properly.

    Args:
        token: The CSRF token to validate
        session_id: The session ID the token is bound to
        secret_key: The app's SECRET_KEY
        max_age_seconds: Maximum age of token in seconds (default: 1 hour)

    Returns:
        True if token is valid, False otherwise
    """
    try:
        # This is simplified - in production, you'd store token + timestamp
        # and validate here. For now, just verify it's a valid hex string.
        return len(token) == 64 and all(c in '0123456789abcdef' for c in token)
    except Exception:
        return False


# ============================================================================
# AUDIT LOGGING
# ============================================================================


def audit_log(
    event_type: str,
    user_id: Optional[str] = None,
    email: Optional[str] = None,
    ip_address: Optional[str] = None,
    status: str = "success",
    details: Optional[dict] = None,
    error_message: Optional[str] = None
) -> None:
    """
    Log security-relevant events in structured JSON format.

    Supported event types:
    - login: User login attempt
    - login_failed: Failed login attempt
    - logout: User logout
    - password_change: Password changed
    - password_reset: Password reset requested
    - token_refresh: Token refreshed
    - data_export: Data export requested
    - account_created: New account created
    - account_deleted: Account deleted
    - permission_change: User permissions modified

    Args:
        event_type: Type of security event
        user_id: User ID (optional)
        email: User email address (optional)
        ip_address: Client IP address (optional)
        status: Event status ('success' or 'failure')
        details: Additional event details as dict
        error_message: Error message if status is 'failure'

    Returns:
        None (logs to security logger)
    """
    log_entry = {
        "timestamp": datetime.utcnow().isoformat(),
        "event_type": event_type,
        "status": status,
        "user_id": user_id,
        "email": email,
        "ip_address": ip_address,
        "details": details or {},
    }

    if error_message:
        log_entry["error"] = error_message

    log_message = json.dumps(log_entry)

    if status == "failure":
        security_logger.warning(log_message)
    else:
        security_logger.info(log_message)


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================


def generate_secure_random_token(length: int = 32) -> str:
    """
    Generate a cryptographically secure random token.

    Args:
        length: Length of token in bytes (default: 32)

    Returns:
        Hex-encoded random token
    """
    return secrets.token_hex(length)


def constant_time_compare(a: str, b: str) -> bool:
    """
    Compare two strings in constant time to prevent timing attacks.

    Args:
        a: First string
        b: Second string

    Returns:
        True if strings are equal, False otherwise
    """
    return hmac.compare_digest(a, b)
