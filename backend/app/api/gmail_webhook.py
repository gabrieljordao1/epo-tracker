"""
Gmail webhook endpoints for Google Cloud Pub/Sub push notifications.
Receives notifications when new emails arrive in Gmail.
"""

import logging
import json
import base64
import hashlib
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, status as http_status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import EmailConnection, User, WebhookLog
from ..models.schemas import GmailWebhookPayload, WebhookSetupResponse, AgentProcessingResult
from ..services.gmail_api import GmailAPIService
from ..services.agent_pipeline import AgentPipelineService

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/webhook", tags=["webhooks"])

# In-memory deduplication cache for recent historyIds
_recent_notifications = set()


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

        # Fetch history to get message IDs
        history_result = await gmail_api.get_history(
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires_at,
            start_history_id=history_id,
        )

        if not history_result.get("success"):
            logger.error(f"Failed to get history: {history_result.get('error')}")
            return

        message_ids = history_result.get("messages", [])
        logger.info(f"Found {len(message_ids)} new messages")

        # Process each message
        for message_id in message_ids:
            try:
                # Fetch full message
                msg_result = await gmail_api.get_message(
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_expires_at=token_expires_at,
                    message_id=message_id,
                )

                if not msg_result.get("success"):
                    logger.warning(f"Failed to fetch message {message_id}")
                    continue

                # Extract vendor email from "From" field
                from_field = msg_result.get("from", "")
                vendor_email = from_field.split("<")[-1].rstrip(">") if "<" in from_field else from_field
                vendor_email = vendor_email.strip()

                if not vendor_email:
                    logger.warning(f"Could not extract vendor email from: {from_field}")
                    continue

                # Process through agent pipeline
                subject = msg_result.get("subject", "")
                body = msg_result.get("body", "")

                # Get email connection ID
                email_conn_query = select(EmailConnection).where(
                    EmailConnection.email_address == email_address
                )
                email_conn_result = await session.execute(email_conn_query)
                email_conn = email_conn_result.scalars().first()
                email_connection_id = email_conn.id if email_conn else None

                pipeline_result = await agent.process_new_email(
                    session=session,
                    email_subject=subject,
                    email_body=body,
                    vendor_email=vendor_email,
                    company_id=company_id,
                    email_connection_id=email_connection_id,
                )

                logger.info(
                    f"Message {message_id} processed: "
                    f"created={pipeline_result.get('created')}, "
                    f"confidence={pipeline_result.get('confidence_score'):.2f}"
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

        # Log the webhook
        payload_hash = hashlib.sha256(message_data.encode()).hexdigest()
        webhook_log = WebhookLog(
            company_id=0,  # Will be updated when we find the company
            source="gmail",
            payload_hash=payload_hash,
            status="received",
        )
        session.add(webhook_log)
        await session.commit()

        # Find the email connection
        email_conn_query = select(EmailConnection).where(
            EmailConnection.email_address == email_address
        )
        email_conn_result = await session.execute(email_conn_query)
        email_conn = email_conn_result.scalars().first()

        if not email_conn:
            logger.warning(f"No email connection found for {email_address}")
            webhook_log.status = "completed"
            webhook_log.error_message = "No email connection found"
            await session.commit()
            return {"status": "ok"}

        # Update webhook log with company ID
        webhook_log.company_id = email_conn.company_id
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
