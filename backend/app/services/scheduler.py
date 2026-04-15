"""
Background job scheduler for automated tasks:
- Email sync (polling Gmail every 5 minutes)
- Auto follow-up emails for pending EPOs (daily)
- Stale EPO escalation (daily)
"""

import logging
from datetime import datetime, timedelta

from sqlalchemy import select, and_

from ..core.database import async_session_maker
from ..core.config import get_settings
from sqlalchemy import or_

from ..models.models import (
    EPO, EPOFollowup, EmailConnection, Company,
    EPOStatus, FollowupStatus,
)
from .email_parser import EmailParserService
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


async def renew_gmail_watches():
    """
    Renew Gmail watch subscriptions every 6 days.
    Gmail watches expire after 7 days, so we renew them proactively.
    """
    from .gmail_api import GmailAPIService

    logger.info("Renewing Gmail watch subscriptions...")

    gmail_api = GmailAPIService(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )

    async with async_session_maker() as session:
        # Find all active Gmail connections with expiring watches
        expiring_threshold = datetime.utcnow() + timedelta(days=1)

        query = select(EmailConnection).where(
            (EmailConnection.provider == "gmail")
            & (EmailConnection.is_active.is_(True))
            & (
                (EmailConnection.watch_expiration.is_(None))
                | (EmailConnection.watch_expiration < expiring_threshold)
            )
        )
        result = await session.execute(query)
        connections = result.scalars().all()

        renewed_count = 0
        for conn in connections:
            try:
                if not settings.GMAIL_PUBSUB_TOPIC:
                    logger.warning("GMAIL_PUBSUB_TOPIC not set, skipping watch renewal")
                    continue

                # Decrypt stored tokens before passing to Gmail API
                from ..core.security import decrypt_token
                try:
                    _acc = decrypt_token(conn.access_token, settings.SECRET_KEY) if conn.access_token else ""
                except Exception:
                    _acc = conn.access_token or ""
                try:
                    _ref = decrypt_token(conn.refresh_token, settings.SECRET_KEY) if conn.refresh_token else ""
                except Exception:
                    _ref = conn.refresh_token or ""

                watch_result = await gmail_api.setup_watch(
                    access_token=_acc,
                    refresh_token=_ref,
                    token_expires_at=conn.token_expires_at,
                    email_address=conn.email_address,
                    pubsub_topic=settings.GMAIL_PUBSUB_TOPIC,
                )

                if watch_result.get("success"):
                    conn.gmail_history_id = watch_result.get("history_id")
                    conn.watch_expiration = watch_result.get("watch_expiration")
                    renewed_count += 1
                    logger.info(f"Gmail watch renewed for {conn.email_address}")
                else:
                    logger.error(
                        f"Failed to renew watch for {conn.email_address}: "
                        f"{watch_result.get('error')}"
                    )

            except Exception as e:
                logger.error(f"Error renewing watch for {conn.email_address}: {e}")
                continue

        await session.commit()
        logger.info(f"Gmail watch renewal complete: {renewed_count} renewed")


async def run_smart_followup_check():
    """
    Run smart follow-up check for all companies.
    Sends follow-ups at strategic times: 3, 5, and 7 days.
    """
    from .agent_pipeline import AgentPipelineService

    logger.info("Running smart follow-up check...")

    agent = AgentPipelineService()

    async with async_session_maker() as session:
        # Get all companies
        company_query = select(Company)
        company_result = await session.execute(company_query)
        companies = company_result.scalars().all()

        total_followups_sent = 0
        for company in companies:
            try:
                result = await agent.run_followup_check(session, company.id)
                if result.get("success"):
                    total_followups_sent += result.get("followups_sent", 0)
                    logger.info(
                        f"Company {company.name}: {result.get('epos_checked')} EPOs checked, "
                        f"{result.get('followups_sent')} follow-ups sent"
                    )
                else:
                    logger.error(f"Follow-up check failed for {company.name}")

            except Exception as e:
                logger.error(f"Error running follow-up check for {company.name}: {e}")
                continue

        logger.info(f"Smart follow-up check complete: {total_followups_sent} total follow-ups sent")


async def run_weekly_digest():
    """Send weekly digest emails to all company admins/managers.
    Runs every Monday at 8 AM.
    """
    from .weekly_digest import send_weekly_digest

    logger.info("Running weekly digest job...")
    try:
        result = await send_weekly_digest()
        logger.info(
            f"Weekly digest complete: {result.get('total_sent', 0)} sent, "
            f"{result.get('total_failed', 0)} failed across {result.get('companies_processed', 0)} companies"
        )
    except Exception as e:
        logger.error(f"Weekly digest job failed: {e}")


async def run_amount_backfill():
    """Self-healing: automatically re-parse amounts for EPOs with missing
    or zero amounts across ALL companies.

    Runs regex-only pass (no network) every hour. This means any time the
    parser patterns improve, old rows heal themselves without user action.

    Also flags EmailConnections as needing reconnection when Gmail refresh
    fails — the UI banner reads this flag.
    """
    logger.info("Running amount backfill (auto-healing)...")
    parser = EmailParserService()

    async with async_session_maker() as session:
        query = select(EPO).where(or_(EPO.amount.is_(None), EPO.amount == 0))
        result = await session.execute(query)
        epos = result.scalars().all()

        updated = 0
        for epo in epos:
            try:
                subject = epo.raw_email_subject or ""
                body = epo.raw_email_body or ""
                text = f"{subject}\n{body}".strip()
                if not text:
                    continue
                amount, _ = parser._extract_amount(text)
                if amount and amount > 0:
                    epo.amount = float(amount)
                    updated += 1
            except Exception as e:
                logger.error(f"Auto-backfill EPO #{epo.id} failed: {e}")
                continue

        await session.commit()
        logger.info(f"Auto-backfill complete: {updated}/{len(epos)} EPOs healed")


async def check_gmail_connection_health():
    """Ping Gmail API for each active connection. If auth fails, mark
    the connection as inactive so the UI can prompt reconnection.
    """
    from .gmail_api import GmailAPIService

    logger.info("Checking Gmail connection health...")
    gmail_api = GmailAPIService(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
    )

    async with async_session_maker() as session:
        query = select(EmailConnection).where(
            (EmailConnection.provider == "gmail")
            & (EmailConnection.is_active.is_(True))
        )
        result = await session.execute(query)
        conns = result.scalars().all()

        from ..core.security import decrypt_token
        import httpx
        unhealthy = 0
        for conn in conns:
            try:
                # Decrypt stored token
                try:
                    access_token = decrypt_token(conn.access_token, settings.SECRET_KEY)
                except Exception:
                    conn.is_active = False
                    unhealthy += 1
                    continue

                # Probe Gmail profile endpoint
                url = "https://www.googleapis.com/gmail/v1/users/me/profile"
                async with httpx.AsyncClient() as client:
                    r = await client.get(
                        url,
                        headers={"Authorization": f"Bearer {access_token}"},
                        timeout=8.0,
                    )
                if r.status_code == 401:
                    conn.is_active = False
                    unhealthy += 1
                    logger.warning(
                        f"Gmail connection {conn.email_address} marked inactive "
                        f"(401 from Google — token revoked or expired)"
                    )
            except Exception as e:
                logger.error(f"Health check for {conn.email_address} errored: {e}")
                continue

        await session.commit()
        logger.info(f"Gmail health check: {unhealthy}/{len(conns)} marked inactive")


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

        # Renew Gmail watches every 6 days at 2 AM
        scheduler.add_job(
            renew_gmail_watches,
            CronTrigger(hour=2, minute=0, day_of_week="0"),  # Every Monday at 2 AM
            id="renew_gmail_watches",
            replace_existing=True,
        )

        # Smart follow-up check daily at 10 AM
        scheduler.add_job(
            run_smart_followup_check,
            CronTrigger(hour=10, minute=0),  # 10:00 AM
            id="smart_followup_check",
            replace_existing=True,
        )

        # Weekly digest every Monday at 8 AM
        scheduler.add_job(
            run_weekly_digest,
            CronTrigger(day_of_week="0", hour=8, minute=0),  # Monday 8:00 AM
            id="weekly_digest",
            replace_existing=True,
        )

        # Auto-backfill EPO amounts every hour (self-healing)
        scheduler.add_job(
            run_amount_backfill,
            CronTrigger(minute=15),  # Every hour at :15
            id="amount_backfill",
            replace_existing=True,
        )

        # Gmail connection health check every 30 min
        scheduler.add_job(
            check_gmail_connection_health,
            CronTrigger(minute="*/30"),
            id="gmail_health_check",
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
