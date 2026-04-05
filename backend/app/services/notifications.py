"""
Notification service — sends SMS (Twilio) and email notifications for EPO events.
"""
import logging
from typing import Optional

from ..core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()


class NotificationService:
    """Handles SMS and email notifications for EPO status changes."""

    def __init__(self):
        self._twilio_client = None

    @property
    def twilio_client(self):
        if self._twilio_client is None and settings.TWILIO_ACCOUNT_SID:
            try:
                from twilio.rest import Client
                self._twilio_client = Client(
                    settings.TWILIO_ACCOUNT_SID,
                    settings.TWILIO_AUTH_TOKEN,
                )
            except ImportError:
                logger.warning("Twilio SDK not installed — SMS disabled")
            except Exception as e:
                logger.error(f"Failed to init Twilio client: {e}")
        return self._twilio_client

    async def send_sms(self, to_number: str, message: str) -> bool:
        """Send an SMS via Twilio."""
        client = self.twilio_client
        if not client:
            logger.info(f"SMS skipped (Twilio not configured): {to_number} — {message[:50]}")
            return False

        try:
            msg = client.messages.create(
                body=message,
                from_=settings.TWILIO_PHONE_NUMBER,
                to=to_number,
            )
            logger.info(f"SMS sent to {to_number}: SID={msg.sid}")
            return True
        except Exception as e:
            logger.error(f"SMS failed to {to_number}: {e}")
            return False

    async def notify_new_epo(
        self,
        phone_number: Optional[str],
        epo_vendor: str,
        epo_community: str,
        epo_lot: str,
        epo_amount: Optional[float],
    ) -> bool:
        """Notify about a new EPO created from email sync."""
        if not phone_number:
            return False

        amount_str = f"${epo_amount:,.0f}" if epo_amount else "TBD"
        message = (
            f"[Onyx] New EPO: {epo_vendor} at {epo_community} Lot {epo_lot} "
            f"for {amount_str}. Check your dashboard."
        )
        return await self.send_sms(phone_number, message)

    async def notify_status_change(
        self,
        phone_number: Optional[str],
        epo_vendor: str,
        epo_lot: str,
        old_status: str,
        new_status: str,
    ) -> bool:
        """Notify about an EPO status change."""
        if not phone_number:
            return False

        message = (
            f"[Onyx] EPO Update: {epo_vendor} Lot {epo_lot} "
            f"changed from {old_status} to {new_status}."
        )
        return await self.send_sms(phone_number, message)

    async def notify_approval_needed(
        self,
        phone_number: Optional[str],
        requestor_name: str,
        epo_vendor: str,
        epo_community: str,
        epo_lot: str,
    ) -> bool:
        """Notify manager that an EPO needs approval."""
        if not phone_number:
            return False

        message = (
            f"[Onyx] Approval needed: {requestor_name} submitted EPO for "
            f"{epo_vendor} at {epo_community} Lot {epo_lot}. Review in app."
        )
        return await self.send_sms(phone_number, message)

    async def notify_overdue(
        self,
        phone_number: Optional[str],
        count: int,
        total_value: float,
    ) -> bool:
        """Notify about overdue EPOs."""
        if not phone_number:
            return False

        message = (
            f"[Onyx] You have {count} overdue EPOs worth ${total_value:,.0f}. "
            f"Send follow-ups from your dashboard."
        )
        return await self.send_sms(phone_number, message)


# Singleton
notification_service = NotificationService()
