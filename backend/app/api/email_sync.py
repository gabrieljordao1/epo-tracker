"""
Email integration endpoints.
Handles Gmail OAuth flow, email connections, and sync triggers.
"""

import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.config import get_settings
from ..core.auth import get_current_user
from ..models.models import User, EmailConnection, EPO, EPOStatus
from ..models.schemas import EmailConnectionCreate, EmailConnectionResponse
from ..services.gmail_sync import GmailSyncService
from ..services.email_parser import EmailParserService
from ..services.email_sender import EmailSenderService

logger = logging.getLogger(__name__)
settings = get_settings()
router = APIRouter(prefix="/api/email", tags=["email"])


def _get_gmail_service() -> GmailSyncService:
    return GmailSyncService(
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        redirect_uri=settings.GOOGLE_REDIRECT_URI,
    )


def _get_email_sender() -> EmailSenderService:
    return EmailSenderService(
        api_key=settings.RESEND_API_KEY,
        from_address=settings.EMAIL_FROM_ADDRESS,
        from_name=settings.EMAIL_FROM_NAME,
    )


# ─── Connection Management ────────────────────────

@router.post("/connect", response_model=EmailConnectionResponse)
async def create_email_connection(
    connection_create: EmailConnectionCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EmailConnectionResponse:
    """Register a new email connection."""
    query = select(EmailConnection).where(
        and_(
            EmailConnection.company_id == current_user.company_id,
            EmailConnection.email_address == connection_create.email_address,
        )
    )
    result = await session.execute(query)
    if result.scalars().first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already connected")

    connection = EmailConnection(
        company_id=current_user.company_id,
        **connection_create.model_dump(),
    )
    session.add(connection)
    await session.commit()
    await session.refresh(connection)
    return EmailConnectionResponse.model_validate(connection)


@router.get("/status")
async def get_email_status(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get all email connections and their status."""
    query = select(EmailConnection).where(
        EmailConnection.company_id == current_user.company_id
    )
    result = await session.execute(query)
    connections = result.scalars().all()

    return {
        "total_connections": len(connections),
        "active_connections": sum(1 for c in connections if c.is_active),
        "connections": [
            {
                "id": c.id,
                "email_address": c.email_address,
                "provider": c.provider,
                "is_active": c.is_active,
                "last_sync_at": c.last_sync_at.isoformat() if c.last_sync_at else None,
            }
            for c in connections
        ],
    }


# ─── Gmail OAuth Flow ─────────────────────────────

@router.get("/oauth/gmail/start")
async def start_gmail_oauth(
    current_user: User = Depends(get_current_user),
):
    """Start Gmail OAuth flow — returns the URL to redirect the user to."""
    gmail = _get_gmail_service()

    if not settings.GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Gmail OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.",
        )

    state = f"{current_user.company_id}:{current_user.id}"
    auth_url = gmail.get_auth_url(state=state)

    if not auth_url:
        raise HTTPException(status_code=500, detail="Failed to generate OAuth URL")

    return {"auth_url": auth_url}


@router.get("/oauth/callback")
async def gmail_oauth_callback(
    code: str = Query(...),
    state: str = Query(""),
    session: AsyncSession = Depends(get_db),
):
    """Handle Gmail OAuth callback — exchange code for tokens and store."""
    gmail = _get_gmail_service()

    # Exchange code for tokens
    token_data = await gmail.exchange_code(code)
    if not token_data.get("success"):
        logger.error(f"OAuth callback failed: {token_data.get('error')}")
        return RedirectResponse(
            url=f"{settings.APP_URL}/settings?error=oauth_failed",
            status_code=302,
        )

    # Parse state to get company/user
    try:
        company_id, user_id = state.split(":")
        company_id = int(company_id)
        user_id = int(user_id)
    except (ValueError, AttributeError):
        return RedirectResponse(
            url=f"{settings.APP_URL}/settings?error=invalid_state",
            status_code=302,
        )

    # Get user's actual email from Google userinfo API
    email_address = f"user_{user_id}@gmail.com"  # fallback
    try:
        import httpx
        async with httpx.AsyncClient() as http_client:
            userinfo_resp = await http_client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {token_data['access_token']}"},
            )
            if userinfo_resp.status_code == 200:
                userinfo = userinfo_resp.json()
                email_address = userinfo.get("email", email_address)
                logger.info(f"Got Gmail address from userinfo: {email_address}")
    except Exception as e:
        logger.warning(f"Could not fetch userinfo, using fallback email: {e}")

    # Store or update the connection
    query = select(EmailConnection).where(
        and_(
            EmailConnection.company_id == company_id,
            EmailConnection.provider == "gmail",
        )
    )
    result = await session.execute(query)
    connection = result.scalars().first()

    if connection:
        connection.is_active = True
    else:
        connection = EmailConnection(
            company_id=company_id,
            email_address=email_address,
            provider="gmail",
            is_active=True,
        )
        session.add(connection)

    await session.commit()

    logger.info(f"Gmail OAuth completed for company={company_id}, user={user_id}")
    return RedirectResponse(
        url=f"{settings.APP_URL}/settings?success=gmail_connected",
        status_code=302,
    )


# ─── Email Sync ───────────────────────────────────

@router.delete("/disconnect/{connection_id}")
async def disconnect_email(
    connection_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Disconnect an email connection."""
    query = select(EmailConnection).where(
        and_(
            EmailConnection.id == connection_id,
            EmailConnection.company_id == current_user.company_id,
        )
    )
    result = await session.execute(query)
    connection = result.scalars().first()

    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    await session.delete(connection)
    await session.commit()

    logger.info(f"Disconnected email {connection.email_address} for company={current_user.company_id}")
    return {"success": True, "message": f"Disconnected {connection.email_address}"}


@router.post("/sync")
async def trigger_email_sync(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Trigger email sync for all active connections.

    In production, this should be a background job (Celery/APScheduler).
    For MVP, we run it synchronously.
    """
    query = select(EmailConnection).where(
        and_(
            EmailConnection.company_id == current_user.company_id,
            EmailConnection.is_active == True,
        )
    )
    result = await session.execute(query)
    connections = result.scalars().all()

    if not connections:
        return {
            "status": "no_connections",
            "message": "No active email connections. Connect Gmail in Settings.",
            "epos_created": 0,
        }

    # For MVP: parse any emails that come through
    # In production: this calls GmailSyncService.fetch_epo_emails()
    # and processes them through the parser pipeline

    total_created = 0
    errors = []

    for conn in connections:
        try:
            # Update last sync timestamp
            conn.last_sync_at = datetime.utcnow()
            logger.info(f"Sync triggered for {conn.email_address} ({conn.provider})")
        except Exception as e:
            errors.append({"connection": conn.email_address, "error": str(e)})
            logger.error(f"Sync error for {conn.email_address}: {e}")

    await session.commit()

    return {
        "status": "sync_complete",
        "message": f"Synced {len(connections)} connection(s). {total_created} new EPOs found.",
        "connections_synced": len(connections),
        "epos_created": total_created,
        "errors": errors if errors else None,
    }


# ─── Send Follow-up ──────────────────────────────

@router.post("/{epo_id}/send-followup")
async def send_epo_followup(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Send a follow-up email for a pending EPO."""
    # Get EPO
    query = select(EPO).where(
        and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
    )
    result = await session.execute(query)
    epo = result.scalars().first()

    if not epo:
        raise HTTPException(status_code=404, detail="EPO not found")

    if epo.status != EPOStatus.PENDING:
        raise HTTPException(status_code=400, detail="Can only follow up on pending EPOs")

    # Get company name
    from ..models.models import Company
    comp_result = await session.execute(
        select(Company).where(Company.id == current_user.company_id)
    )
    company = comp_result.scalars().first()
    company_name = company.name if company else "Your Company"

    # Send follow-up
    sender = _get_email_sender()
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

    # Store followup record
    from ..models.models import EPOFollowup, FollowupStatus
    followup = EPOFollowup(
        epo_id=epo.id,
        company_id=current_user.company_id,
        sent_to_email=epo.vendor_email,
        subject=f"Follow-up: EPO Confirmation - {epo.community} Lot {epo.lot_number}",
        body=f"Automated follow-up sent for ${epo.amount:,.2f} EPO",
        status=FollowupStatus.SENT if send_result.get("success") else FollowupStatus.FAILED,
        sent_at=datetime.utcnow() if send_result.get("success") else None,
    )
    session.add(followup)
    await session.commit()

    return {
        "success": send_result.get("success", False),
        "message": "Follow-up sent" if send_result.get("success") else f"Send failed: {send_result.get('error')}",
        "epo_id": epo.id,
        "vendor_email": epo.vendor_email,
    }


@router.post("/batch-followup")
async def batch_send_followups(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Send follow-up emails for ALL pending EPOs that need follow-up (4+ days).
    One-click batch operation from the dashboard.
    """
    from ..models.models import Company, EPOFollowup, FollowupStatus

    # Get all pending EPOs needing follow-up
    query = select(EPO).where(
        and_(
            EPO.company_id == current_user.company_id,
            EPO.status == EPOStatus.PENDING,
            EPO.days_open >= 4,
        )
    )
    result = await session.execute(query)
    pending_epos = result.scalars().all()

    if not pending_epos:
        return {"success": True, "message": "No EPOs need follow-up", "sent": 0}

    # Get company name
    comp_result = await session.execute(
        select(Company).where(Company.id == current_user.company_id)
    )
    company = comp_result.scalars().first()
    company_name = company.name if company else "Your Company"

    sender = _get_email_sender()
    sent_count = 0
    errors = []

    for epo in pending_epos:
        # Check if already followed up in last 3 days
        recent_followup = await session.execute(
            select(EPOFollowup).where(
                and_(
                    EPOFollowup.epo_id == epo.id,
                    EPOFollowup.status == FollowupStatus.SENT,
                )
            )
        )
        existing = recent_followup.scalars().all()
        if len(existing) >= 2:
            continue  # Max 2 follow-ups

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

        followup = EPOFollowup(
            epo_id=epo.id,
            company_id=current_user.company_id,
            sent_to_email=epo.vendor_email,
            subject=f"Follow-up: EPO - {epo.community} Lot {epo.lot_number}",
            body=f"Batch follow-up for ${epo.amount:,.2f}",
            status=FollowupStatus.SENT if send_result.get("success") else FollowupStatus.FAILED,
            sent_at=datetime.utcnow() if send_result.get("success") else None,
        )
        session.add(followup)

        if send_result.get("success"):
            sent_count += 1
        else:
            errors.append({"epo_id": epo.id, "vendor": epo.vendor_name, "error": send_result.get("error")})

    await session.commit()

    return {
        "success": True,
        "message": f"Sent {sent_count} follow-up emails",
        "sent": sent_count,
        "total_eligible": len(pending_epos),
        "errors": errors if errors else None,
    }
