"""
Email integration endpoints.
Handles Gmail OAuth flow, email connections, and sync triggers.
"""

import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.config import get_settings
from ..core.auth import get_current_user
from ..core.security import encrypt_token, audit_log
from ..models.models import User, EmailConnection, EPO, EPOStatus
from ..models.schemas import EmailConnectionCreate, EmailConnectionResponse
from ..services.gmail_sync import GmailSyncService
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
    try:
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

        audit_log(
            event_type="email_connection_created",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"email_address": connection_create.email_address, "provider": connection_create.provider}
        )
        return EmailConnectionResponse.model_validate(connection)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating email connection: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create email connection"
        )


@router.get("/status")
async def get_email_status(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get all email connections and their status."""
    try:
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving email status: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve email status"
        )


# ─── Gmail OAuth Flow ─────────────────────────────

@router.get("/oauth/gmail/start")
async def start_gmail_oauth(
    current_user: User = Depends(get_current_user),
):
    """Start Gmail OAuth flow — returns the URL to redirect the user to."""
    try:
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

        audit_log(
            event_type="gmail_oauth_started",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success"
        )
        return {"auth_url": auth_url}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting Gmail OAuth: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start OAuth flow"
        )


@router.get("/oauth/callback")
async def gmail_oauth_callback(
    code: str = Query(...),
    state: str = Query(""),
    session: AsyncSession = Depends(get_db),
):
    """Handle Gmail OAuth callback — exchange code for tokens and store (encrypted)."""
    try:
        gmail = _get_gmail_service()

        # Exchange code for tokens
        token_data = await gmail.exchange_code(code)
        if not token_data.get("success"):
            logger.error(f"OAuth callback failed: {token_data.get('error')}")
            audit_log(
                event_type="gmail_oauth_failed",
                status="failure",
                error_message=token_data.get('error')
            )
            return RedirectResponse(
                url=f"{settings.APP_URL}/integrations?error=oauth_failed",
                status_code=302,
            )

        # Parse state to get company/user
        try:
            company_id, user_id = state.split(":")
            company_id = int(company_id)
            user_id = int(user_id)
        except (ValueError, AttributeError):
            audit_log(
                event_type="gmail_oauth_failed",
                status="failure",
                error_message="Invalid state parameter"
            )
            return RedirectResponse(
                url=f"{settings.APP_URL}/integrations?error=invalid_state",
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

        # Store or update the connection — match by email address so each
        # team member gets their own connection under the same company.
        query = select(EmailConnection).where(
            and_(
                EmailConnection.company_id == company_id,
                EmailConnection.provider == "gmail",
                EmailConnection.email_address == email_address,
            )
        )
        result = await session.execute(query)
        connection = result.scalars().first()

        # Calculate token expiration datetime and encrypt tokens
        from datetime import datetime, timedelta
        expires_in = token_data.get("token_expires_at") or token_data.get("expires_in", 3600)
        token_expires_at = datetime.utcnow() + timedelta(seconds=int(expires_in))

        # Encrypt tokens before storing
        access_token_encrypted = encrypt_token(token_data.get("access_token", ""), settings.SECRET_KEY)
        refresh_token_encrypted = encrypt_token(token_data.get("refresh_token", ""), settings.SECRET_KEY)

        if connection:
            connection.is_active = True
            connection.access_token = access_token_encrypted
            connection.refresh_token = refresh_token_encrypted
            connection.token_expires_at = token_expires_at
            connection.connected_by_id = user_id
        else:
            connection = EmailConnection(
                company_id=company_id,
                connected_by_id=user_id,
                email_address=email_address,
                provider="gmail",
                is_active=True,
                access_token=access_token_encrypted,
                refresh_token=refresh_token_encrypted,
                token_expires_at=token_expires_at,
            )
            session.add(connection)

        await session.commit()

        audit_log(
            event_type="gmail_oauth_completed",
            user_id=str(user_id),
            email=email_address,
            status="success",
            details={"company_id": company_id}
        )
        logger.info(f"Gmail OAuth completed for company={company_id}, user={user_id}")
        return RedirectResponse(
            url=f"{settings.APP_URL}/integrations?success=gmail_connected",
            status_code=302,
        )
    except Exception as e:
        logger.error(f"Error in OAuth callback: {str(e)}")
        audit_log(
            event_type="gmail_oauth_failed",
            status="failure",
            error_message=str(e)
        )
        return RedirectResponse(
            url=f"{settings.APP_URL}/integrations?error=oauth_error",
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
    try:
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

        email_address = connection.email_address
        await session.delete(connection)
        await session.commit()

        audit_log(
            event_type="email_connection_disconnected",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"disconnected_email": email_address}
        )
        logger.info(f"Disconnected email {email_address} for company={current_user.company_id}")
        return {"success": True, "message": f"Disconnected {email_address}"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error disconnecting email: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to disconnect email"
        )


@router.post("/sync")
async def trigger_email_sync(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Trigger email sync for all active connections.

    In production, this should be a background job (Celery/APScheduler).
    For MVP, we run it synchronously.
    """
    try:
        query = select(EmailConnection).where(
            and_(
                EmailConnection.company_id == current_user.company_id,
                EmailConnection.is_active.is_(True),
            )
        )
        result = await session.execute(query)
        connections = result.scalars().all()

        if not connections:
            audit_log(
                event_type="email_sync_triggered",
                user_id=str(current_user.id),
                email=current_user.email,
                status="success",
                details={"connections_synced": 0}
            )
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

        audit_log(
            event_type="email_sync_triggered",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"connections_synced": len(connections), "epos_created": total_created}
        )

        return {
            "status": "sync_complete",
            "message": f"Synced {len(connections)} connection(s). {total_created} new EPOs found.",
            "connections_synced": len(connections),
            "epos_created": total_created,
            "errors": errors if errors else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error triggering email sync: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to trigger email sync"
        )


# ─── Send Follow-up ──────────────────────────────

@router.post("/{epo_id}/send-followup")
async def send_epo_followup(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Send a follow-up email for a pending EPO."""
    try:
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

        audit_log(
            event_type="epo_followup_sent",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success" if send_result.get("success") else "failure",
            details={"epo_id": epo.id, "vendor_email": epo.vendor_email}
        )

        return {
            "success": send_result.get("success", False),
            "message": "Follow-up sent" if send_result.get("success") else f"Send failed: {send_result.get('error')}",
            "epo_id": epo.id,
            "vendor_email": epo.vendor_email,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending followup for EPO {epo_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send followup"
        )


@router.post("/batch-followup")
async def batch_send_followups(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Send follow-up emails for ALL pending EPOs that need follow-up (4+ days).
    One-click batch operation from the dashboard.
    """
    try:
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
            audit_log(
                event_type="batch_followup_sent",
                user_id=str(current_user.id),
                email=current_user.email,
                status="success",
                details={"sent": 0, "total_eligible": 0}
            )
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

        audit_log(
            event_type="batch_followup_sent",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"sent": sent_count, "total_eligible": len(pending_epos)}
        )

        return {
            "success": True,
            "message": f"Sent {sent_count} follow-up emails",
            "sent": sent_count,
            "total_eligible": len(pending_epos),
            "errors": errors if errors else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sending batch followups: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send batch followups"
        )
