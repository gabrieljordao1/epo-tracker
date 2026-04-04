"""
Gmail REST API service for webhook-compatible email access.
Handles Gmail push notifications, message fetching, and watch management.
"""

import logging
import json
import base64
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

            # Parse headers
            headers_list = message_data.get("payload", {}).get("headers", [])
            headers_dict = {h["name"]: h["value"] for h in headers_list}

            # Extract body
            body = self._extract_message_body(message_data.get("payload", {}))

            return {
                "success": True,
                "message_id": message_id,
                "subject": headers_dict.get("Subject", ""),
                "from": headers_dict.get("From", ""),
                "to": headers_dict.get("To", ""),
                "date": headers_dict.get("Date", ""),
                "body": body,
            }
        except Exception as e:
            logger.error(f"Get message error: {e}")
            return {"success": False, "error": str(e)}

    def _extract_message_body(self, payload: Dict[str, Any]) -> str:
        """Extract text body from Gmail payload."""
        if "parts" in payload:
            for part in payload["parts"]:
                if part["mimeType"] == "text/plain":
                    data = part.get("body", {}).get("data", "")
                    if data:
                        return base64.urlsafe_b64decode(data).decode("utf-8")
        else:
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8")
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
            date_str = since_date.strftime("%Y/%m/%d")
            params = {
                "q": f"after:{date_str}",
                "maxResults": max_results,
            }

            async with httpx.AsyncClient() as client:
                response = await client.get(url, headers=headers, params=params, timeout=10.0)

            if response.status_code != 200:
                logger.error(f"List messages failed: {response.text}")
                return []

            data = response.json()
            message_ids = [m["id"] for m in data.get("messages", [])]

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
