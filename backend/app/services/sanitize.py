"""
Input sanitization utilities to prevent XSS and injection.
"""

import logging
import re

logger = logging.getLogger(__name__)


def sanitize_html(text: str) -> str:
    """Strip HTML tags and dangerous content from text."""
    try:
        import bleach
        return bleach.clean(text, tags=[], strip=True)
    except ImportError:
        # Fallback: basic tag stripping
        return re.sub(r'<[^>]+>', '', text)


def sanitize_email_body(body: str) -> str:
    """Sanitize an email body for safe storage and display."""
    cleaned = sanitize_html(body)
    # Remove null bytes
    cleaned = cleaned.replace('\x00', '')
    # Cap length
    if len(cleaned) > 10000:
        cleaned = cleaned[:10000] + "\n... [truncated]"
    return cleaned


def sanitize_text_field(text: str, max_length: int = 500) -> str:
    """Sanitize a short text field."""
    if not text:
        return ""
    cleaned = sanitize_html(text)
    cleaned = cleaned.replace('\x00', '').strip()
    return cleaned[:max_length]
