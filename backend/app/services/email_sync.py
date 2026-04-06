import base64
import re
from datetime import datetime
from typing import List

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import httpx

from ..models.models import EmailConnection, EPO
from .email_parser import EmailParserService


class EmailSyncService:
    """Service to sync emails from various providers"""

    def __init__(self, session: AsyncSession):
        self.session = session
        self.parser_service = EmailParserService()
        self.epo_patterns = [
            r"export\s+promotion\s+opportunity",
            r"epo",
            r"export\s+opportunity",
            r"international\s+trade",
            r"tariff\s+rate\s+quota",
            r"trq",
        ]

    async def sync_emails(self, connection_id: int, company_id: int):
        """Sync emails from a connection"""
        query = select(EmailConnection).where(
            and_(
                EmailConnection.id == connection_id,
                EmailConnection.company_id == company_id,
            )
        )
        result = await self.session.execute(query)
        connection = result.scalars().first()

        if not connection:
            return

        try:
            if connection.provider.lower() == "gmail":
                await self._sync_gmail(connection)
            elif connection.provider.lower() in ["outlook", "microsoft"]:
                await self._sync_outlook(connection)

            # Update last sync time
            connection.last_sync = datetime.utcnow()
            connection.sync_error = None

        except Exception as e:
            connection.sync_error = str(e)

        await self.session.commit()

    async def _sync_gmail(self, connection: EmailConnection):
        """Sync emails from Gmail using Gmail API"""
        headers = {
            "Authorization": f"Bearer {connection.access_token}",
            "Accept": "application/json",
        }

        # Search for unread emails matching EPO patterns
        search_query = self._build_gmail_search_query()

        async with httpx.AsyncClient() as client:
            # Get message list
            response = await client.get(
                "https://www.googleapis.com/gmail/v1/users/me/messages",
                params={"q": search_query, "maxResults": 50},
                headers=headers,
            )

            if response.status_code != 200:
                raise Exception(f"Gmail API error: {response.text}")

            messages = response.json().get("messages", [])

            # Fetch and parse each message
            for message_info in messages:
                message_id = message_info["id"]
                message_response = await client.get(
                    f"https://www.googleapis.com/gmail/v1/users/me/messages/{message_id}",
                    headers=headers,
                    params={"format": "full"},
                )

                if message_response.status_code == 200:
                    message_data = message_response.json()
                    await self._process_gmail_message(message_data, connection)

                    # Mark as read
                    await client.post(
                        f"https://www.googleapis.com/gmail/v1/users/me/messages/{message_id}/modify",
                        json={"removeLabelIds": ["UNREAD"]},
                        headers=headers,
                    )

    async def _sync_outlook(self, connection: EmailConnection):
        """Sync emails from Outlook using Microsoft Graph API"""
        headers = {
            "Authorization": f"Bearer {connection.access_token}",
            "Accept": "application/json",
        }

        async with httpx.AsyncClient() as client:
            # Get unread messages
            response = await client.get(
                "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages",
                params={
                    "filter": "isRead eq false",
                    "top": 50,
                },
                headers=headers,
            )

            if response.status_code != 200:
                raise Exception(f"Microsoft Graph API error: {response.text}")

            messages = response.json().get("value", [])

            for message_data in messages:
                # Check if message matches EPO pattern
                subject = message_data.get("subject", "")
                body_preview = message_data.get("bodyPreview", "")

                if self._matches_epo_pattern(subject, body_preview):
                    await self._process_outlook_message(message_data, connection)

                    # Mark as read
                    message_id = message_data["id"]
                    await client.patch(
                        f"https://graph.microsoft.com/v1.0/me/messages/{message_id}",
                        json={"isRead": True},
                        headers=headers,
                    )

    async def _process_gmail_message(self, message_data: dict, connection: EmailConnection):
        """Process a Gmail message and extract EPO data"""
        headers = message_data.get("payload", {}).get("headers", [])

        # Extract header values
        subject = self._get_header_value(headers, "Subject")
        sender = self._get_header_value(headers, "From")
        sender_email = self._extract_email(sender)

        # Extract body
        body = self._extract_gmail_body(message_data.get("payload", {}))

        # Check if matches EPO pattern
        if not self._matches_epo_pattern(subject, body):
            return

        # Parse email with Claude
        parsed_data = await self.parser_service.parse_email(subject, body, sender_email)

        # Save to database
        await self._save_epo(parsed_data, connection)

    async def _process_outlook_message(self, message_data: dict, connection: EmailConnection):
        """Process an Outlook message and extract EPO data"""
        subject = message_data.get("subject", "")
        body = message_data.get("bodyPreview", "")
        sender = message_data.get("from", {}).get("emailAddress", {})
        sender_email = sender.get("address", "")

        # Parse email with Claude
        parsed_data = await self.parser_service.parse_email(subject, body, sender_email)

        # Save to database
        await self._save_epo(parsed_data, connection)

    async def _save_epo(self, parsed_data: dict, connection: EmailConnection):
        """Save parsed EPO to database"""
        # Check if EPO already exists
        vendor_email = parsed_data.get("vendor_email")
        if vendor_email:
            query = select(EPO).where(
                and_(
                    EPO.vendor_email == vendor_email,
                    EPO.company_id == connection.company_id,
                )
            )
            result = await self.session.execute(query)
            if result.scalars().first():
                return

        # Create EPO record
        epo = EPO(
            company_id=connection.company_id,
            email_connection_id=connection.id,
            vendor_name=parsed_data.get("builder_name") or parsed_data.get("vendor_name") or "Unknown Builder",
            vendor_email=parsed_data.get("vendor_email"),
            lot_number=parsed_data.get("lot_number"),
            community=parsed_data.get("community"),
            amount=parsed_data.get("amount"),
            currency=parsed_data.get("currency", "USD"),
            description=parsed_data.get("description"),
            confirmation_number=parsed_data.get("confirmation_number"),
            contact_person=parsed_data.get("contact_person"),
            phone=parsed_data.get("phone"),
            website=parsed_data.get("website"),
            notes=parsed_data.get("notes"),
            confidence_score=parsed_data.get("confidence_score"),
            needs_review=parsed_data.get("needs_review", False),
        )

        self.session.add(epo)
        await self.session.flush()

    def _build_gmail_search_query(self) -> str:
        """Build Gmail search query for EPO emails"""
        patterns = " OR ".join([f'"{pattern}"' for pattern in self.epo_patterns])
        return f"({patterns}) is:unread"

    def _matches_epo_pattern(self, subject: str, body: str) -> bool:
        """Check if email matches EPO patterns"""
        text = f"{subject} {body}".lower()

        for pattern in self.epo_patterns:
            if re.search(pattern, text, re.IGNORECASE):
                return True

        return False

    def _extract_gmail_body(self, payload: dict) -> str:
        """Extract text body from Gmail payload"""
        parts = payload.get("parts", [])

        if not parts:
            # Simple message
            data = payload.get("body", {}).get("data", "")
            if data:
                return base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
            return ""

        # Multipart message
        body = ""
        for part in parts:
            mime_type = part.get("mimeType", "")

            if mime_type == "text/plain":
                data = part.get("body", {}).get("data", "")
                if data:
                    body = base64.urlsafe_b64decode(data).decode("utf-8", errors="ignore")
                    break

        return body

    def _get_header_value(self, headers: List[dict], name: str) -> str:
        """Get value from email headers"""
        for header in headers:
            if header.get("name") == name:
                return header.get("value", "")
        return ""

    def _extract_email(self, email_string: str) -> str:
        """Extract email address from 'Name <email@domain.com>' format"""
        match = re.search(r"<(.+?)>", email_string)
        if match:
            return match.group(1)
        # Check if it's just an email
        if "@" in email_string:
            return email_string.strip()
        return ""
