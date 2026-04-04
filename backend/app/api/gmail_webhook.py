"""
Gmail webhook endpoints for Google Cloud Pub/Sub push notifications.
Receives notifications when new emails arrive in Gmail.
"""

import logging
import json
import base64
import hashlib
import re
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status as http_status
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import EmailConnection, User, WebhookLog, EPO, EPOStatus
from ..models.schemas import GmailWebhookPayload, WebhookSetupResponse, AgentProcessingResult
from ..services.gmail_api import GmailAPIService
from ..services.agent_pipeline import AgentPipelineService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])

# In-memory deduplication cache for recent historyIds
_recent_notifications = set()

def _extract_email_address(raw: str) -> str:
    """Extract email from 'Name <email@domain.com>' format."""
    match = re.search(r"<(.+?)>", raw)
    if match:
        return match.group(1).strip().lower()
    if "@" in raw:
        return raw.strip().lower()
    return ""


def _extract_all_emails(header_value: str) -> list:
    """Extract all email addresses from a TO/CC header (comma-separated)."""
    if not header_value:
        return []
    parts = header_value.split(",")
    emails = []
    for part in parts:
        email = _extract_email_address(part.strip())
        if email:
            emails.append(email)
    return emails


def _is_internal_email(email: str, internal_addresses: set, internal_domains: set) -> bool:
    """
    Check if an email is internal to the company.
    Uses dynamic sets built from the company's email connections and user emails.
    """
    email_lower = email.lower()
    # Check exact match against known internal addresses
    if email_lower in internal_addresses:
        return True
    # Check domain match against company domains
    domain = email_lower.split("@")[-1] if "@" in email_lower else ""
    if domain in internal_domains:
        return True
    return False


async def _build_internal_email_set(session: AsyncSession, company_id: int, tracker_email: str) -> tuple:
    """
    Dynamically build the set of internal email addresses and domains
    for a given company. This makes the system multi-tenant — no hardcoded emails.

    Returns: (internal_addresses: set, internal_domains: set)
    """
    internal_addresses = set()
    internal_domains = set()

    # 1) The tracker email itself is always internal
    internal_addresses.add(tracker_email.lower())

    # 2) All company users' emails (login + work) are internal
    user_query = select(User.email, User.work_email).where(User.company_id == company_id)
    result = await session.execute(user_query)
    for user_email, work_email in result:
        for em in [user_email, work_email]:
            if em:
                email_lower = em.lower()
                internal_addresses.add(email_lower)
                domain = email_lower.split("@")[-1]
                internal_domains.add(domain)

    # 3) All company email connections are internal
    conn_query = select(EmailConnection.email_address).where(
        EmailConnection.company_id == company_id
    )
    conn_result = await session.execute(conn_query)
    for (conn_email,) in conn_result:
        internal_addresses.add(conn_email.lower())

    return internal_addresses, internal_domains


def _builder_name_from_domain(email: str) -> str:
    """
    Derive builder name from email domain.
    e.g. john@meritagehomes.com → Meritage Homes
         info@dr-horton.com → Dr Horton
    """
    try:
        domain = email.split("@")[1]
        # Remove TLD
        name_part = domain.rsplit(".", 1)[0]
        # Remove common subdomains
        name_part = re.sub(r"^(mail|email|info|sales|www)\.", "", name_part)
        # Split on hyphens and dots, capitalize each word
        words = re.split(r"[-.]", name_part)
        return " ".join(w.capitalize() for w in words if w)
    except Exception:
        return "Unknown Builder"


async def _process_gmail_notification(
    email_address: str,
    company_id: int,
    history_id: str,
    access_token: str,
    refresh_token: str,
    token_expires_at: Optional[datetime],
    session: AsyncSession,
):
    """
    Process a Gmail notification in the background.
    Fetches the new messages and triggers the agent pipeline.
    """
    try:
        logger.info(
            f"Processing Gmail notification: {email_address}, "
            f"company={company_id}, historyId={history_id}"
        )

        # Initialize services
        gmail_api = GmailAPIService(
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
        )
        agent = AgentPipelineService()

        # Get email connection to use stored history_id as start point
        email_conn_query = select(EmailConnection).where(
            EmailConnection.email_address == email_address
        )
        email_conn_result = await session.execute(email_conn_query)
        email_conn = email_conn_result.scalars().first()

        # Use stored history_id (last known) instead of notification's history_id
        # Gmail history API returns changes AFTER startHistoryId, so we need our
        # last checkpoint, not the notification's ID which points to the change itself
        stored_history_id = email_conn.gmail_history_id if email_conn else history_id
        logger.info(f"Using stored history_id={stored_history_id} (notification={history_id})")

        # Fetch history to get message IDs
        history_result = await gmail_api.get_history(
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            start_history_id=stored_history_id,
        )

        if not history_result.get("success"):
            logger.error(f"Failed to get history: {history_result.get('error')}")
            return

        message_ids = history_result.get("messages", [])
        logger.info(f"Found {len(message_ids)} new messages")

        # Build the dynamic internal email set for this company
        # This makes multi-tenant filtering work — no hardcoded emails
        internal_addresses, internal_domains = await _build_internal_email_set(
            session, company_id, email_address
        )
        logger.info(
            f"Internal email filter: {len(internal_addresses)} addresses, "
            f"{len(internal_domains)} domains"
        )

        # Process each message
        for message_id in message_ids:
            try:
                # Fetch full message (now includes threadId, In-Reply-To, attachments)
                msg_result = await gmail_api.get_message(
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_expires_at=token_expires_at,
                    message_id=message_id,
                )

                if not msg_result.get("success"):
                    logger.warning(f"Failed to fetch message {message_id}")
                    continue

                from_field = msg_result.get("from", "")
                to_field = msg_result.get("to", "")
                cc_field = msg_result.get("cc", "")
                subject = msg_result.get("subject", "")
                body = msg_result.get("body", "")
                thread_id = msg_result.get("thread_id", "")
                in_reply_to = msg_result.get("in_reply_to", "")
                image_attachments = msg_result.get("image_attachments", [])

                # ── REPLY DETECTION ──────────────────────────────────
                # Check if this email is a reply to an existing EPO thread.
                # Strategy:
                #   1. Match by gmail_thread_id (most reliable)
                #   2. Match by In-Reply-To header → gmail_message_id
                #   3. If sender is an external builder with a pending EPO, treat as reply

                matched_epo = None

                # Strategy 1: Thread ID match
                if thread_id:
                    epo_query = select(EPO).where(
                        (EPO.gmail_thread_id == thread_id)
                        & (EPO.company_id == company_id)
                        & (EPO.status == EPOStatus.PENDING)
                    ).order_by(EPO.created_at.desc())
                    epo_result = await session.execute(epo_query)
                    matched_epo = epo_result.scalars().first()
                    if matched_epo:
                        logger.info(
                            f"REPLY DETECTED (thread match): message {message_id} "
                            f"→ EPO #{matched_epo.id} (thread={thread_id})"
                        )

                # Strategy 2: In-Reply-To header match
                if not matched_epo and in_reply_to:
                    epo_query = select(EPO).where(
                        (EPO.gmail_message_id == in_reply_to.strip("<>"))
                        & (EPO.company_id == company_id)
                    )
                    epo_result = await session.execute(epo_query)
                    matched_epo = epo_result.scalars().first()
                    if matched_epo:
                        logger.info(
                            f"REPLY DETECTED (In-Reply-To match): message {message_id} "
                            f"→ EPO #{matched_epo.id}"
                        )

                # Strategy 3: Sender is external builder with pending EPO
                if not matched_epo:
                    sender_email = _extract_email_address(from_field)
                    if sender_email and not _is_internal_email(sender_email, internal_addresses, internal_domains):
                        # External sender — check if they have any pending EPOs
                        epo_query = select(EPO).where(
                            (EPO.vendor_email == sender_email)
                            & (EPO.company_id == company_id)
                            & (EPO.status == EPOStatus.PENDING)
                        ).order_by(EPO.created_at.desc())
                        epo_result = await session.execute(epo_query)
                        matched_epo = epo_result.scalars().first()
                        if matched_epo:
                            logger.info(
                                f"REPLY DETECTED (builder email match): {sender_email} "
                                f"→ EPO #{matched_epo.id}"
                            )

                # ── ROUTE: Reply vs New EPO ──────────────────────────
                if matched_epo:
                    # This is a REPLY — process through reply intelligence
                    reply_result = await agent.process_reply_email(
                        session=session,
                        epo=matched_epo,
                        email_subject=subject,
                        email_body=body,
                        image_attachments=image_attachments,
                        gmail_api=gmail_api,
                        access_token=access_token,
                        refresh_token=refresh_token,
                        token_expires_at=token_expires_at,
                        message_id=message_id,
                    )
                    logger.info(
                        f"Reply processed for EPO #{matched_epo.id}: "
                        f"intent={reply_result.get('intent')}, "
                        f"status={reply_result.get('new_status')}, "
                        f"image_parsed={reply_result.get('image_parsed')}"
                    )
                    continue

                # ── NEW EPO FLOW (original logic) ────────────────────

                # 1) Identify the SUBMITTER from the FROM field
                submitter_email = _extract_email_address(from_field)
                if not submitter_email:
                    logger.warning(f"Could not extract submitter email from: {from_field}")
                    continue

                # Match submitter to a User record to get created_by_id
                submitted_by_id = None
                user_query = select(User).where(
                    or_(
                        User.email.ilike(submitter_email),
                        User.work_email.ilike(submitter_email),
                    )
                )
                user_result = await session.execute(user_query)
                submitter_user = user_result.scalars().first()
                if submitter_user:
                    submitted_by_id = submitter_user.id
                    logger.info(f"Matched submitter {submitter_email} → User #{submitter_user.id} ({submitter_user.full_name})")
                else:
                    logger.warning(f"No User record found for submitter: {submitter_email}")

                # 2) Identify the BUILDER from the TO recipients
                all_to = _extract_all_emails(to_field)
                all_cc = _extract_all_emails(cc_field)
                all_recipients = all_to + all_cc

                builder_email = ""
                for recipient in all_recipients:
                    if not _is_internal_email(recipient, internal_addresses, internal_domains) and recipient != submitter_email:
                        builder_email = recipient
                        break

                # Derive builder name from domain
                builder_name = _builder_name_from_domain(builder_email) if builder_email else "Unknown Builder"

                logger.info(
                    f"Email routing: submitter={submitter_email}, "
                    f"builder={builder_email} ({builder_name}), "
                    f"subject={subject}"
                )

                # Get email connection ID
                email_connection_id = email_conn.id if email_conn else None

                # Process through agent pipeline (now with thread tracking)
                pipeline_result = await agent.process_new_email(
                    session=session,
                    email_subject=subject,
                    email_body=body,
                    vendor_email=builder_email or submitter_email,
                    company_id=company_id,
                    email_connection_id=email_connection_id,
                    builder_name=builder_name,
                    builder_email=builder_email,
                    submitter_email=submitter_email,
                    submitted_by_id=submitted_by_id,
                    gmail_thread_id=thread_id,
                    gmail_message_id=message_id,
                )

                confidence = pipeline_result.get('confidence_score', 0)
                logger.info(
                    f"Message {message_id} processed: "
                    f"created={pipeline_result.get('created')}, "
                    f"confidence={confidence:.2f}, "
                    f"submitter={submitter_email}, builder={builder_name}"
                )

            except Exception as e:
                logger.error(f"Error processing message {message_id}: {e}", exc_info=True)
                continue

        # Update the history_id for next notification
        if email_conn and history_result.get("next_history_id"):
            email_conn.gmail_history_id = history_result.get("next_history_id")
            await session.commit()

    except Exception as e:
        logger.error(f"Background notification processing error: {e}", exc_info=True)


@router.post("/gmail", status_code=200)
async def gmail_webhook(
    payload: GmailWebhookPayload,
    background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_db),
):
    """
    Receive Gmail push notifications from Google Cloud Pub/Sub.

    Google Cloud Pub/Sub sends notifications in this format:
    {
        "message": {
            "data": "<base64-encoded JSON>",
            "messageId": "...",
            "publishTime": "..."
        },
        "subscription": "..."
    }

    Returns 200 immediately, processes async in background.
    """
    try:
        # Decode the message
        message_data = payload.message.get("data", "")
        if not message_data:
            logger.warning("Empty message data in webhook")
            return {"status": "ok"}

        # Decode base64
        try:
            decoded = base64.b64decode(message_data).decode("utf-8")
            history_data = json.loads(decoded)
        except Exception as e:
            logger.error(f"Failed to decode message: {e}")
            return {"status": "ok"}

        email_address = history_data.get("emailAddress")
        history_id = history_data.get("historyId")

        if not email_address or not history_id:
            logger.warning(f"Missing required fields: {history_data}")
            return {"status": "ok"}

        # Deduplicate notifications
        notification_key = f"{email_address}:{history_id}"
        if notification_key in _recent_notifications:
            logger.info(f"Duplicate notification, ignoring: {notification_key}")
            return {"status": "ok"}

        _recent_notifications.add(notification_key)

        # Limit cache size to avoid unbounded growth
        if len(_recent_notifications) > 10000:
            _recent_notifications.clear()

        # Find the email connection first (need company_id for webhook log)
        email_conn_query = select(EmailConnection).where(
            EmailConnection.email_address == email_address
        )
        email_conn_result = await session.execute(email_conn_query)
        email_conn = email_conn_result.scalars().first()

        if not email_conn:
            logger.warning(f"No email connection found for {email_address}")
            return {"status": "ok"}

        # Log the webhook with valid company_id
        payload_hash = hashlib.sha256(message_data.encode()).hexdigest()
        webhook_log = WebhookLog(
            company_id=email_conn.company_id,
            source="gmail",
            payload_hash=payload_hash,
            status="received",
        )
        session.add(webhook_log)
        await session.commit()

        # Queue background task
        background_tasks.add_task(
            _process_gmail_notification,
            email_address=email_address,
            company_id=email_conn.company_id,
            history_id=history_id,
            access_token=email_conn.access_token,
            refresh_token=email_conn.refresh_token,
            token_expires_at=email_conn.token_expires_at,
            session=session,
        )

        logger.info(f"Gmail notification queued: {email_address}, historyId={history_id}")
        return {"status": "ok"}

    except Exception as e:
        logger.error(f"Webhook error: {e}", exc_info=True)
        return {"status": "ok"}


@router.post("/gmail/setup", response_model=WebhookSetupResponse)
async def setup_gmail_webhook(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Register Gmail push notifications for the user's email connections.
    Requires authentication.

    Returns the watch expiration time for each connection.
    """
    try:
        # Get all active email connections for this user's company
        email_conns_query = select(EmailConnection).where(
            (EmailConnection.company_id == current_user.company_id)
            & (EmailConnection.provider == "gmail")
            & (EmailConnection.is_active == True)
        )
        email_conns_result = await session.execute(email_conns_query)
        email_conns = email_conns_result.scalars().all()

        if not email_conns:
            raise HTTPException(
                status_code=http_status.HTTP_404_NOT_FOUND,
                detail="No active Gmail connections found",
            )

        if not settings.GMAIL_PUBSUB_TOPIC:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="GMAIL_PUBSUB_TOPIC not configured",
            )

        # Initialize Gmail API
        gmail_api = GmailAPIService(
            client_id=settings.GOOGLE_CLIENT_ID,
            client_secret=settings.GOOGLE_CLIENT_SECRET,
        )

        # Register watch for each connection
        latest_expiration = None
        for email_conn in email_conns:
            try:
                # Force token refresh before watch setup to ensure fresh access token
                from ..services.gmail_sync import GmailSyncService
                sync_service = GmailSyncService(
                    client_id=settings.GOOGLE_CLIENT_ID,
                    client_secret=settings.GOOGLE_CLIENT_SECRET,
                    redirect_uri=settings.GOOGLE_REDIRECT_URI,
                )
                refresh_result = await sync_service.refresh_access_token(
                    email_conn.refresh_token
                )
                if refresh_result.get("success"):
                    email_conn.access_token = refresh_result["access_token"]
                    from datetime import timedelta
                    email_conn.token_expires_at = datetime.utcnow() + timedelta(hours=1)
                    logger.info(f"Refreshed token for {email_conn.email_address} before watch setup")
                else:
                    logger.warning(
                        f"Token refresh failed for {email_conn.email_address}: "
                        f"{refresh_result.get('error')}. Trying with existing token."
                    )

                watch_result = await gmail_api.setup_watch(
                    access_token=email_conn.access_token,
                    refresh_token=email_conn.refresh_token,
                    token_expires_at=email_conn.token_expires_at,
                    email_address=email_conn.email_address,
                    pubsub_topic=settings.GMAIL_PUBSUB_TOPIC,
                )

                if watch_result.get("success"):
                    email_conn.gmail_history_id = watch_result.get("history_id")
                    email_conn.watch_expiration = watch_result.get("watch_expiration")
                    latest_expiration = watch_result.get("watch_expiration")

                    logger.info(
                        f"Gmail watch registered for {email_conn.email_address}, "
                        f"history_id={watch_result.get('history_id')}, "
                        f"expires: {latest_expiration}"
                    )
                else:
                    logger.error(
                        f"Failed to register watch for {email_conn.email_address}: "
                        f"{watch_result.get('error')}"
                    )

            except Exception as e:
                logger.error(f"Error setting up watch for {email_conn.email_address}: {e}")
                continue

        await session.commit()

        return WebhookSetupResponse(
            success=True,
            message="Gmail webhooks registered successfully",
            watch_expiration=latest_expiration,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Setup webhook error: {e}", exc_info=True)
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=str(e),
        )
