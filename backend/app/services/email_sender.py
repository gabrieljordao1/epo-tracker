"""
Email sending service using Resend.
Handles followup emails, notifications, and system emails.
"""

import logging
from typing import Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


class EmailSenderService:
    """Send emails via Resend API."""

    def __init__(self, api_key: str = "", from_address: str = "notifications@epotracker.com", from_name: str = "EPO Tracker"):
        self.api_key = api_key
        self.from_address = from_address
        self.from_name = from_name
        self._resend = None

    def _get_client(self):
        if not self._resend and self.api_key:
            try:
                import resend
                resend.api_key = self.api_key
                self._resend = resend
            except ImportError:
                logger.warning("resend package not installed — email sending disabled")
        return self._resend

    async def send_followup(
        self,
        to_email: str,
        vendor_name: str,
        epo_description: str,
        epo_amount: float,
        community: str,
        lot_number: str,
        days_open: int,
        company_name: str,
        vendor_portal_url: str = "",
    ) -> Dict[str, Any]:
        """Send a followup email to a vendor about a pending EPO."""
        subject = f"Follow-up: EPO Confirmation Needed — {community} Lot {lot_number}"

        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #0C1B2A; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0; font-size: 20px;">EPO Confirmation Request</h1>
                <p style="margin: 4px 0 0; opacity: 0.7; font-size: 14px;">From {company_name}</p>
            </div>

            <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
                <p>Hi {vendor_name},</p>

                <p>We're following up on an EPO that has been pending for <strong>{days_open} days</strong>.
                Please review and confirm at your earliest convenience:</p>

                <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px; margin: 16px 0;">
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Community</td><td style="padding: 6px 0; font-weight: 600;">{community}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Lot</td><td style="padding: 6px 0; font-weight: 600;">{lot_number}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Description</td><td style="padding: 6px 0;">{epo_description}</td></tr>
                        <tr><td style="padding: 6px 0; color: #6b7280; font-size: 13px;">Amount</td><td style="padding: 6px 0; font-weight: 600; color: #059669;">${epo_amount:,.2f}</td></tr>
                    </table>
                </div>

                {f'''
                <div style="text-align: center; margin: 20px 0;">
                    <a href="{vendor_portal_url}" style="display: inline-block; padding: 12px 32px; background: #059669; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">
                        View & Confirm EPO
                    </a>
                    <p style="font-size: 12px; color: #9ca3af; margin-top: 8px;">Or reply to this email with your PO number</p>
                </div>
                ''' if vendor_portal_url else '<p>To confirm, simply reply to this email with your PO/confirmation number, or reply "confirmed".</p>'}


                <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">
                    This is an automated follow-up from {company_name}'s EPO Tracker.<br>
                    If you've already confirmed this EPO, please disregard.
                </p>
            </div>
        </div>
        """

        return await self._send(
            to=to_email,
            subject=subject,
            html=html_body,
        )

    async def send_notification(
        self,
        to_email: str,
        subject: str,
        message: str,
    ) -> Dict[str, Any]:
        """Send a general notification email."""
        html_body = f"""
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <div style="background: #0C1B2A; color: white; padding: 24px; border-radius: 12px 12px 0 0;">
                <h1 style="margin: 0; font-size: 20px;">EPO Tracker Notification</h1>
            </div>
            <div style="border: 1px solid #e5e7eb; border-top: none; padding: 24px; border-radius: 0 0 12px 12px;">
                <p>{message}</p>
            </div>
        </div>
        """
        return await self._send(to=to_email, subject=subject, html=html_body)

    async def _send(self, to: str, subject: str, html: str) -> Dict[str, Any]:
        """Send an email via Resend."""
        client = self._get_client()

        if not client:
            logger.warning(f"Email not sent (no API key): to={to}, subject={subject}")
            return {
                "success": False,
                "error": "Email sending not configured — set RESEND_API_KEY",
                "to": to,
                "subject": subject,
            }

        try:
            params = {
                "from": f"{self.from_name} <{self.from_address}>",
                "to": [to],
                "subject": subject,
                "html": html,
            }

            result = client.Emails.send(params)
            logger.info(f"Email sent successfully: to={to}, subject={subject}, id={result.get('id', 'unknown')}")

            return {
                "success": True,
                "message_id": result.get("id"),
                "to": to,
                "subject": subject,
                "sent_at": datetime.utcnow().isoformat(),
            }
        except Exception as e:
            logger.error(f"Email send failed: to={to}, error={str(e)}")
            return {
                "success": False,
                "error": str(e),
                "to": to,
                "subject": subject,
            }
