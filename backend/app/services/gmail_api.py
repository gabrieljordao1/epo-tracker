"""
Gmail REST API service for webhook-compatible email access.
Handles Gmail push notifications, message fetching, and watch management.
"""

import logging
import base64
import re
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request

logger = logging.getLogger(__name__)


class GmailAPIService:
    """Gmail REST API client for webhook-compatible access."""

    GMAIL_API_BASE = "https://www.googleapis.com/gmail/v1"
    SCOPES = [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/gmail.labels",
    ]

    def __init__(self, client_id: str = "", client_secret: str = ""):
        self.client_id = client_id
        self.client_secret = client_secret

    def _ensure_valid_token(self, access_token: str, refresh_token: str, token_expires_at: Optional[datetime]) -> tuple:
        """
        Check if token is expired and refresh if needed.
        Returns (valid_access_token, new_expiry_time)
        """
        try:
            # Strip timezone info for comparison (DB may store tz-aware datetimes)
            now = datetime.utcnow()
            expiry_naive = token_expires_at
            if token_expires_at and token_expires_at.tzinfo is not None:
                expiry_naive = token_expires_at.replace(tzinfo=None)

            # Always refresh if: no expiry set, or expiry is within 5 minutes
            needs_refresh = (
                not expiry_naive
                or now > (expiry_naive - timedelta(minutes=5))
            )

            if needs_refresh and refresh_token:
                try:
                    creds = Credentials(
                        token=access_token,
                        refresh_token=refresh_token,
                        client_id=self.client_id,
                        client_secret=self.client_secret,
                        token_uri="https://oauth2.googleapis.com/token",
                    )
                    creds.refresh(Request())
                    new_expiry = creds.expiry if creds.expiry else datetime.utcnow() + timedelta(hours=1)
                    logger.info(f"Token refreshed successfully, new expiry: {new_expiry}")
                    return creds.token, new_expiry
                except Exception as e:
                    logger.error(f"Token refresh failed: {e}")
                    # Fall through to return original token
        except Exception as e:
            logger.error(f"Token validation error: {e}")

        return access_token, token_expires_at

    async def setup_watch(
        self,
        access_token: str,
        refresh_token: str,
        token_expires_at: Optional[datetime],
        email_address: str,
        pubsub_topic: str,
    ) -> Dict[str, Any]:
        """
        Register Gmail push notifications via the Gmail API.
        Google will push notifications to the Pub/Sub topic when new emails arrive.
        """
        try:
            # Ensure token is valid
            access_token, token_expires_at = self._ensure_valid_token(
                access_token, refresh_token, token_expires_at
            )

            url = f"{self.GMAIL_API_BASE}/users/me/watch"
            headers = {"Authorization": f"Bearer {access_token}"}
            payload = {"labelIds": ["INBOX"], "topicName": pubsub_topic}

            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, headers=headers, timeout=10.0)

            if response.status_code != 200:
                logger.error(f"Gmail watch setup failed: {response.text}")
                return {"success": False, "error": response.text}

            data = response.json()
            history_id = data.get("historyId")
            expiration = data.get("expiration")  # Milliseconds since epoch

            # Convert expiration to datetime
            watch_expiration = None
            if expiration:
                watch_expiration = datetime.utcfromtimestamp(int(expiration) / 1000)

            logger.info(f"Gmail watch registered for {email_address}, expires: {watch_expiration}")
            return {
                "success": True,
                "history_id": history_id,
                "watch_expiration": watch_expiration,
            }
        except Exception as e:
            logger.error(f"Gmail watch setup error: {e}")
            return {"success": False, "error": str(e)}

    async def get_history(
        self,
        access_token: str,
        refresh_token: str,
        token_expires_at: Optional[datetime],
        start_history_id: str,
    ) -> Dict[str, Any]:
        """
        Fetch message changes since a historyId.
        Used to process notifications efficiently.
        """
        try:
            # Ensure token is valid
            access_token, token_expires_at = self._ensure_valid_token(
                access_token, refresh_token, token_expires_at
            )

            url = f"{self.GMAIL_API_BASE}/users/me/history"
            headers = {"Authorization": f"Bearer {access_token}"}
            params = {
                "startHistoryId": start_history_id,
                "historyTypes": "messageAdded",
                "maxResults": 100,
            }

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=10.0)

            if response.status_code != 200:
                logger.error(f"Get history failed: {response.text}")
                return {"success": False, "error": response.text, "messages": []}

            data = response.json()
            history = data.get("history", [])
            messages = []

            # Extract message IDs from history
            for entry in history:
                for message in entry.get("messagesAdded", []):
                    messages.append(message.get("message", {}).get("id"))

            return {
                "success": True,
                "messages": [m for m in messages if m],
                "next_history_id": data.get("historyId"),
            }
        except Exception as e:
            logger.error(f"Get history error: {e}")
            return {"success": False, "error": str(e), "messages": []}

    async def get_message(
        self,
        access_token: str,
        refresh_token: str,
        token_expires_at: Optional[datetime],
        message_id: str,
    ) -> Dict[str, Any]:
        """
        Fetch full email message by ID.
        Returns threadId, In-Reply-To/References headers, and image attachments.
        """
        try:
            # Ensure token is valid
            access_token, token_expires_at = self._ensure_valid_token(
                access_token, refresh_token, token_expires_at
            )

            url = f"{self.GMAIL_API_BASE}/users/me/messages/{message_id}"
            headers = {"Authorization": f"Bearer {access_token}"}
            params = {"format": "full"}

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=10.0)

            if response.status_code != 200:
                logger.error(f"Get message failed: {response.text}")
                return {"success": False, "error": response.text}

            message_data = response.json()

            # Extract threadId from top-level Gmail response
            thread_id = message_data.get("threadId", "")

            # Parse headers
            headers_list = message_data.get("payload", {}).get("headers", [])
            headers_dict = {h["name"]: h["value"] for h in headers_list}

            # Extract body
            body = self._extract_message_body(message_data.get("payload", {}))

            # Extract image attachments metadata
            image_attachments = self._extract_image_attachments(message_data.get("payload", {}))

            return {
                "success": True,
                "message_id": message_id,
                "thread_id": thread_id,
                "subject": headers_dict.get("Subject", ""),
                "from": headers_dict.get("From", ""),
                "to": headers_dict.get("To", ""),
                "cc": headers_dict.get("Cc", ""),
                "date": headers_dict.get("Date", ""),
                "in_reply_to": headers_dict.get("In-Reply-To", ""),
                "references": headers_dict.get("References", ""),
                "body": body,
                "image_attachments": image_attachments,
            }
        except Exception as e:
            logger.error(f"Get message error: {e}")
            return {"success": False, "error": str(e)}

    def _extract_image_attachments(self, payload: Dict[str, Any]) -> List[Dict[str, str]]:
        """
        Extract image attachment metadata from Gmail payload.
        Returns list of {filename, mimeType, attachmentId, size} for each image.
        """
        attachments = []
        self._find_image_parts(payload, attachments)
        return attachments

    def _find_image_parts(self, part: Dict[str, Any], attachments: List[Dict[str, str]]):
        """Recursively find image parts in MIME structure.

        Handles both:
        - Regular attachments (have attachmentId)
        - Inline images (have body.data directly, e.g., Content-Disposition: inline)
        """
        mime_type = part.get("mimeType", "")

        # Check if this part is an image
        if mime_type.startswith("image/"):
            body = part.get("body", {})
            attachment_id = body.get("attachmentId")
            inline_data = body.get("data")

            if attachment_id:
                attachments.append({
                    "filename": part.get("filename", "image"),
                    "mimeType": mime_type,
                    "attachmentId": attachment_id,
                    "size": body.get("size", 0),
                })
            elif inline_data:
                # Inline image — store base64 data directly
                attachments.append({
                    "filename": part.get("filename", "inline_image"),
                    "mimeType": mime_type,
                    "inlineData": inline_data,
                    "size": body.get("size", 0),
                })
                logger.info(
                    f"Found inline image: {part.get('filename', 'unnamed')} "
                    f"({body.get('size', 0)} bytes)"
                )

        # Recurse into sub-parts
        for sub_part in part.get("parts", []):
            self._find_image_parts(sub_part, attachments)

    async def get_attachment(
        self,
        access_token: str,
        refresh_token: str,
        token_expires_at: Optional[datetime],
        message_id: str,
        attachment_id: str,
    ) -> Optional[bytes]:
        """
        Download an attachment by ID and return raw bytes.
        Used for Gemini Vision to parse screenshot/image attachments.
        """
        try:
            access_token, token_expires_at = self._ensure_valid_token(
                access_token, refresh_token, token_expires_at
            )

            url = (
                f"{self.GMAIL_API_BASE}/users/me/messages/{message_id}"
                f"/attachments/{attachment_id}"
            )
            headers = {"Authorization": f"Bearer {access_token}"}

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, timeout=30.0)

            if response.status_code != 200:
                logger.error(f"Get attachment failed: {response.text}")
                return None

            data = response.json().get("data", "")
            if data:
                return base64.urlsafe_b64decode(data)
            return None
        except Exception as e:
            logger.error(f"Get attachment error: {e}")
            return None

    def _extract_message_body(self, payload: Dict[str, Any]) -> str:
        """Extract text body from Gmail payload.

        Tries text/plain first, then falls back to text/html (stripped of tags).
        Also handles nested multipart structures (e.g., multipart/alternative
        inside multipart/mixed).
        """
        # Try to find text/plain first, then text/html as fallback
        plain_text = self._find_body_by_mime(payload, "text/plain")
        if plain_text:
            return plain_text

        # Fallback: extract HTML and strip tags
        html_text = self._find_body_by_mime(payload, "text/html")
        if html_text:
            # Strip HTML tags to get readable text
            text = re.sub(r'<style[^>]*>.*?</style>', '', html_text, flags=re.DOTALL)
            text = re.sub(r'<script[^>]*>.*?</script>', '', text, flags=re.DOTALL)
            text = re.sub(r'<br\s*/?>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</p>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'</div>', '\n', text, flags=re.IGNORECASE)
            text = re.sub(r'<[^>]+>', '', text)
            # Clean up whitespace
            text = re.sub(r'\n{3,}', '\n\n', text)
            text = text.strip()
            if text:
                logger.info("Extracted body from HTML fallback (no text/plain part)")
                return text

        return ""

    def _find_body_by_mime(self, payload: Dict[str, Any], target_mime: str) -> str:
        """Recursively search MIME parts for a specific content type."""
        mime_type = payload.get("mimeType", "")

        # Direct match (single-part message)
        if mime_type == target_mime:
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8")

        # Multipart — recurse into parts
        for part in payload.get("parts", []):
            result = self._find_body_by_mime(part, target_mime)
            if result:
                return result

        return ""

    async def get_messages_since(
        self,
        access_token: str,
        refresh_token: str,
        token_expires_at: Optional[datetime],
        since_date: datetime,
        max_results: int = 50,
    ) -> List[Dict[str, Any]]:
        """
        Fetch new messages since a given date.
        Returns list of messages with full details.
        """
        try:
            # Ensure token is valid
            access_token, token_expires_at = self._ensure_valid_token(
                access_token, refresh_token, token_expires_at
            )

            url = f"{self.GMAIL_API_BASE}/users/me/messages"
            headers = {"Authorization": f"Bearer {access_token}"}
            # Use newer_than: which is more reliable than after: for recent emails
            # Search ALL mail (no in:inbox filter) so we catch outbound EPO
            # requests the field manager sends to builders, same as the old
            # IMAP code that searched [Gmail]/All Mail.
            days_delta = max(1, (datetime.utcnow() - since_date).days)
            params = {
                "q": f"newer_than:{days_delta}d",
                "maxResults": max_results,
            }
            logger.info(f"Gmail list query: q='{params['q']}', max={max_results}")

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=15.0)

            if response.status_code != 200:
                logger.error(f"List messages failed ({response.status_code}): {response.text}")
                return []

            data = response.json()
            message_ids = [m["id"] for m in data.get("messages", [])]
            logger.info(f"Gmail listed {len(message_ids)} message IDs")

            # Fetch full message details for each ID
            messages = []
            for msg_id in message_ids:
                msg = await self.get_message(access_token, refresh_token, token_expires_at, msg_id)
                if msg.get("success"):
                    messages.append(msg)

            return messages
        except Exception as e:
            logger.error(f"Get messages since error: {e}")
            return []
