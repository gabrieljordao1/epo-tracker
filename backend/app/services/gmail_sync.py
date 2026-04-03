"""
Gmail OAuth + IMAP sync service.
Handles OAuth flow, token management, and email fetching.
"""

import logging
import email as email_lib
import imaplib
from typing import List, Dict, Any, Optional
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Gmail OAuth scopes
GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.labels",
]


class GmailSyncService:
    """Sync emails from Gmail via OAuth + IMAP."""

    def __init__(self, client_id: str = "", client_secret: str = "", redirect_uri: str = ""):
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    def get_auth_url(self, state: str = "") -> str:
        """Generate the OAuth consent URL for Gmail."""
        try:
            from google_auth_oauthlib.flow import Flow

            flow = Flow.from_client_config(
                {
                    "web": {
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": [self.redirect_uri],
                    }
                },
                scopes=GMAIL_SCOPES,
            )
            flow.redirect_uri = self.redirect_uri

            auth_url, _ = flow.authorization_url(
                access_type="offline",
                include_granted_scopes="true",
                prompt="consent",
                state=state,
            )
            return auth_url
        except ImportError:
            logger.error("google-auth-oauthlib not installed")
            return ""
        except Exception as e:
            logger.error(f"Failed to generate auth URL: {e}")
            return ""

    async def exchange_code(self, code: str) -> Dict[str, Any]:
        """Exchange authorization code for tokens."""
        try:
            from google_auth_oauthlib.flow import Flow

            flow = Flow.from_client_config(
                {
                    "web": {
                        "client_id": self.client_id,
                        "client_secret": self.client_secret,
                        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                        "token_uri": "https://oauth2.googleapis.com/token",
                        "redirect_uris": [self.redirect_uri],
                    }
                },
                scopes=GMAIL_SCOPES,
            )
            flow.redirect_uri = self.redirect_uri
            flow.fetch_token(code=code)

            credentials = flow.credentials
            return {
                "access_token": credentials.token,
                "refresh_token": credentials.refresh_token,
                "token_expires_at": credentials.expiry.isoformat() if credentials.expiry else None,
                "success": True,
            }
        except Exception as e:
            logger.error(f"Token exchange failed: {e}")
            return {"success": False, "error": str(e)}

    async def refresh_access_token(self, refresh_token: str) -> Dict[str, Any]:
        """Refresh an expired access token."""
        try:
            from google.oauth2.credentials import Credentials
            from google.auth.transport.requests import Request

            creds = Credentials(
                token=None,
                refresh_token=refresh_token,
                client_id=self.client_id,
                client_secret=self.client_secret,
                token_uri="https://oauth2.googleapis.com/token",
            )
            creds.refresh(Request())

            return {
                "access_token": creds.token,
                "token_expires_at": creds.expiry.isoformat() if creds.expiry else None,
                "success": True,
            }
        except Exception as e:
            logger.error(f"Token refresh failed: {e}")
            return {"success": False, "error": str(e)}

    async def fetch_epo_emails(
        self,
        access_token: str,
        email_address: str,
        since_date: Optional[datetime] = None,
        max_results: int = 50,
    ) -> List[Dict[str, Any]]:
        """Fetch potential EPO emails from Gmail using IMAP + OAuth2."""
        if not since_date:
            since_date = datetime.utcnow() - timedelta(days=7)

        emails = []

        try:
            # Build OAuth2 string for IMAP
            auth_string = f"user={email_address}\x01auth=Bearer {access_token}\x01\x01"

            # Connect to Gmail IMAP
            imap = imaplib.IMAP4_SSL("imap.gmail.com")
            imap.authenticate("XOAUTH2", lambda _: auth_string.encode())
            imap.select("INBOX")

            # Search for recent emails with EPO-related keywords
            date_str = since_date.strftime("%d-%b-%Y")
            search_criteria = f'(SINCE {date_str} OR SUBJECT "EPO" OR SUBJECT "extra" OR SUBJECT "change order" OR SUBJECT "work order" OR SUBJECT "purchase order")'

            _, message_ids = imap.search(None, search_criteria)

            if not message_ids or not message_ids[0]:
                imap.logout()
                return emails

            ids = message_ids[0].split()[-max_results:]  # Get most recent

            for msg_id in ids:
                try:
                    _, msg_data = imap.fetch(msg_id, "(RFC822)")
                    if not msg_data or not msg_data[0]:
                        continue

                    raw_email = msg_data[0][1]
                    msg = email_lib.message_from_bytes(raw_email)

                    # Extract body
                    body = ""
                    if msg.is_multipart():
                        for part in msg.walk():
                            if part.get_content_type() == "text/plain":
                                body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                                break
                            elif part.get_content_type() == "text/html" and not body:
                                body = part.get_payload(decode=True).decode("utf-8", errors="replace")
                    else:
                        body = msg.get_payload(decode=True).decode("utf-8", errors="replace")

                    from_addr = msg.get("From", "")
                    subject = msg.get("Subject", "")
                    date_str = msg.get("Date", "")
                    message_id = msg.get("Message-ID", "")

                    emails.append({
                        "message_id": message_id,
                        "from": from_addr,
                        "subject": subject,
                        "body": body[:5000],  # Cap at 5k chars
                        "date": date_str,
                    })
                except Exception as e:
                    logger.warning(f"Failed to parse email {msg_id}: {e}")
                    continue

            imap.logout()
            logger.info(f"Fetched {len(emails)} potential EPO emails from {email_address}")

        except imaplib.IMAP4.error as e:
            logger.error(f"IMAP error for {email_address}: {e}")
        except Exception as e:
            logger.error(f"Gmail sync error for {email_address}: {e}")

        return emails
