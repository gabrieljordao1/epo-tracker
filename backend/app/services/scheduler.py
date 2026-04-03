"""
Background job scheduler for automated tasks:
- Email sync (polling Gmail every 5 minutes)
- Auto follow-up emails for pending EPOs (daily)
- Stale EPO escalation (daily)
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import async_session_maker
from ..core.config import get_settings
from ..models.models import (
    EPO, EPOFollowup, EmailConnection, Company, User,
    EPOStatus, FollowupStatus,
)
from .email_sender import EmailSenderService

logger = logging.getLogger(__name__)
settings = get_settings()

# Job tracking
_scheduler_running = False


async def run_auto_followups():
    """Send follow-up emails for EPOs that have been pending too long.

    Rules:
    - First follow-up: after 4 days pending
    - Second follow-up: after 7 days pending
    - Max 2 automated follow-ups per EPO
    """
    logger.info("Running auto follow-up job...")

    sender = EmailSenderService(
        api_key=settings.RESEND_API_KEY,
        from_address=settings.EMAIL_FROM_ADDRESS,
        from_name=settings.EMAIL_FROM_NAME,
    )

    async with async_session_maker() as session:
        # Find pending EPOs that need follow-up
        query = select(EPO).where(
            and_(
                EPO.status == EPOStatus.PENDING,
                EPO.days_open >= 4,
            )
        )
        result = await session.execute(query)
        pending_epos = result.scalars().all()

        sent_count = 0
        for epo in pending_epos:
            try:
                # Check how many follow-ups already sent
                followup_query = select(EPOFollowup).where(
                    and_(
                        EPOFollowup.epo_id == epo.id,
                        EPOFollowup.status == FollowupStatus.SENT,
                    )
                )
                followup_result = await session.execute(followup_query)
                existing_followups = followup_result.scalars().all()

                # Max 2 automated follow-ups
                if len(existing_followups) >= 2:
                    continue

                # First follow-up at 4 days, second at 7 days
                if len(existing_followups) == 0 and epo.days_open >= 4:
                    should_send = True
                elif len(existing_followups) == 1 and epo.days_open >= 7:
                    should_send = True
                else:
                    should_send = False

                if not should_send:
                    continue

                # Get company name
                comp_result = await session.execute(
                    select(Company).where(Company.id == epo.company_id)
                )
                company = comp_result.scalars().first()
                company_name = company.name if company else "EPO Tracker"

                # Send the follow-up
                send_result = await sender.send_followup(
                    to_email=epo.vendor_email,
                    vendor_name=epo.vendor_name,
                    epo_description=epo.description or "No description",
                    epo_amount=epo.amount or 0,
                    community=epo.community or "Unknown",
                    lot_number=epo.lot_number or "N/A",
                    days_open=epo.days_open or 0,
                    company_name=company_name,
                )

                # Record the follow-up
                followup = EPOFollowup(
                    epo_id=epo.id,
                    company_id=epo.company_id,
                    sent_to_email=epo.vendor_email,
                    subject=f"Follow-up: EPO - {epo.community} Lot {epo.lot_number}",
                    body=f"Auto follow-up #{len(existing_followups) + 1} for ${epo.amount:,.2f}",
                    status=FollowupStatus.SENT if send_result.get("success") else FollowupStatus.FAILED,
                    sent_at=datetime.utcnow() if send_result.get("success") else None,
                )
                session.add(followup)

                if send_result.get("success"):
                    sent_count += 1

            except Exception as e:
                logger.error(f"Auto follow-up failed for EPO #{epo.id}: {e}")
                continue

        await session.commit()
        logger.info(f"Auto follow-up complete: {sent_count} emails sent for {len(pending_epos)} pending EPOs")


async def update_days_open():
    """Update days_open counter for all pending EPOs.
    Run daily to keep the age counter accurate.
    """
    logger.info("Updating days_open for pending EPOs...")

    async with async_session_maker() as session:
        query = select(EPO).where(EPO.status == EPOStatus.PENDING)
        result = await session.execute(query)
        epos = result.scalars().all()

        updated = 0
        for epo in epos:
            if epo.created_at:
                days = (datetime.utcnow() - epo.created_at.replace(tzinfo=None)).days
                if days != epo.days_open:
                    epo.days_open = days
                    updated += 1

        await session.commit()
        logger.info(f"Updated days_open for {updated}/{len(epos)} pending EPOs")


async def run_all_scheduled_tasks():
    """Run all scheduled tasks. Called by the scheduler or manually."""
    await update_days_open()
    await run_auto_followups()


def start_scheduler():
    """Start the background scheduler. Call this from app startup."""
    global _scheduler_running
    if _scheduler_running:
        return

    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = AsyncIOScheduler()

        # Update days_open every hour
        scheduler.add_job(
            update_days_open,
            CronTrigger(minute=0),  # Every hour at :00
            id="update_days_open",
            replace_existing=True,
        )

        # Auto follow-ups at 9 AM daily
        scheduler.add_job(
            run_auto_followups,
            CronTrigger(hour=9, minute=0),  # 9:00 AM
            id="auto_followups",
            replace_existing=True,
        )

        scheduler.start()
        _scheduler_running = True
        logger.info("Background scheduler started (APScheduler)")

    except ImportError:
        logger.warning(
            "APScheduler not installed — background jobs disabled. "
            "Install with: pip install apscheduler"
        )
    except Exception as e:
        logger.error(f"Failed to start scheduler: {e}")
