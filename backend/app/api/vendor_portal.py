"""
Vendor self-service portal.
NO AUTHENTICATION REQUIRED — uses unique token-based access.
This is the key differentiator: vendors check EPO status via a link, no login.
"""

import secrets
import logging
from typing import Optional
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.security import rate_limit, audit_log
from ..models.models import EPO, VendorAction, Company, EPOStatus

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/vendor", tags=["vendor-portal"])


def generate_vendor_token() -> str:
    """Generate a unique, URL-safe token for vendor access."""
    return secrets.token_urlsafe(32)


@router.get("/epo/{token}")
async def get_epo_by_token(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    """Get EPO details via vendor token. No auth required.

    This is what vendors see when they click the link in their email.
    """
    try:
        query = select(EPO).where(EPO.vendor_token == token)
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(status_code=404, detail="EPO not found or link expired")

        # Get company name
        comp_result = await session.execute(select(Company).where(Company.id == epo.company_id))
        company = comp_result.scalars().first()

        # Log the view
        client_ip = request.client.host if request.client else None
        view_action = VendorAction(
            epo_id=epo.id,
            company_id=epo.company_id,
            action_type="viewed",
            ip_address=client_ip,
        )
        session.add(view_action)
        await session.commit()

        audit_log(
            event_type="vendor_portal_view",
            ip_address=client_ip,
            status="success",
            details={"epo_id": epo.id}
        )

        return {
            "epo": {
                "id": epo.id,
                "vendor_name": epo.vendor_name,
                "community": epo.community,
                "lot_number": epo.lot_number,
                "description": epo.description,
                "amount": epo.amount,
                "status": epo.status.value if hasattr(epo.status, 'value') else epo.status,
                "confirmation_number": epo.confirmation_number,
                "days_open": epo.days_open,
                "created_at": epo.created_at.isoformat() if epo.created_at else None,
            },
            "company_name": company.name if company else "Unknown",
            "can_confirm": epo.status == EPOStatus.PENDING,
            "can_dispute": epo.status == EPOStatus.PENDING,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving EPO by token: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve EPO"
        )


@router.post("/epo/{token}/confirm")
async def vendor_confirm_epo(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    confirmation_number: Optional[str] = None,
    vendor_note: Optional[str] = None,
):
    """Vendor confirms an EPO. No auth required — token-based access.

    Rate limited to prevent abuse (5 attempts per 5 minutes per IP).
    """
    try:
        # Rate limiting per IP
        client_ip = request.client.host if request.client else "unknown"
        _check_rate_limit(f"confirm:{client_ip}", max_attempts=5, window_seconds=300)

        query = select(EPO).where(EPO.vendor_token == token)
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(status_code=404, detail="EPO not found")

        if epo.status != EPOStatus.PENDING:
            raise HTTPException(status_code=400, detail="This EPO has already been processed")

        # Update EPO status
        epo.status = EPOStatus.CONFIRMED
        if confirmation_number:
            epo.confirmation_number = confirmation_number

        # Log the action
        action = VendorAction(
            epo_id=epo.id,
            company_id=epo.company_id,
            action_type="confirmed",
            vendor_note=vendor_note,
            confirmation_number=confirmation_number,
            ip_address=client_ip,
        )
        session.add(action)
        await session.commit()

        audit_log(
            event_type="vendor_confirm_epo",
            ip_address=client_ip,
            status="success",
            details={"epo_id": epo.id, "confirmation_number": confirmation_number}
        )

        logger.info(f"Vendor confirmed EPO #{epo.id} via portal (token={token[:8]}...)")

        return {
            "success": True,
            "message": "EPO confirmed successfully. Thank you!",
            "epo_id": epo.id,
            "new_status": "confirmed",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error confirming EPO: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to confirm EPO"
        )


@router.post("/epo/{token}/dispute")
async def vendor_dispute_epo(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    vendor_note: Optional[str] = None,
):
    """Vendor disputes an EPO. Flags for review.

    Rate limited to prevent abuse (5 attempts per 5 minutes per IP).
    """
    try:
        # Rate limiting per IP
        client_ip = request.client.host if request.client else "unknown"
        _check_rate_limit(f"dispute:{client_ip}", max_attempts=5, window_seconds=300)

        query = select(EPO).where(EPO.vendor_token == token)
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(status_code=404, detail="EPO not found")

        if epo.status != EPOStatus.PENDING:
            raise HTTPException(status_code=400, detail="This EPO has already been processed")

        # Flag for review (don't auto-deny — let the team handle it)
        epo.needs_review = True

        # Log the action
        action = VendorAction(
            epo_id=epo.id,
            company_id=epo.company_id,
            action_type="disputed",
            vendor_note=vendor_note,
            ip_address=client_ip,
        )
        session.add(action)
        await session.commit()

        audit_log(
            event_type="vendor_dispute_epo",
            ip_address=client_ip,
            status="success",
            details={"epo_id": epo.id}
        )

        logger.info(f"Vendor disputed EPO #{epo.id} via portal: {vendor_note}")

        return {
            "success": True,
            "message": "Your dispute has been submitted. The team will review it.",
            "epo_id": epo.id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error disputing EPO: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to submit dispute"
        )


@router.get("/epo/{token}/history")
async def get_epo_vendor_history(
    token: str,
    session: AsyncSession = Depends(get_db),
):
    """Get the action history for a vendor-facing EPO."""
    try:
        query = select(EPO).where(EPO.vendor_token == token)
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(status_code=404, detail="EPO not found")

        # Get all actions
        actions_query = (
            select(VendorAction)
            .where(VendorAction.epo_id == epo.id)
            .order_by(VendorAction.created_at.desc())
        )
        actions_result = await session.execute(actions_query)
        actions = actions_result.scalars().all()

        return {
            "epo_id": epo.id,
            "history": [
                {
                    "action": a.action_type,
                    "note": a.vendor_note,
                    "confirmation_number": a.confirmation_number,
                    "timestamp": a.created_at.isoformat() if a.created_at else None,
                }
                for a in actions
            ],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving vendor history: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve history"
        )


# ─── Rate Limiting Helper ────────────────────────────────

_rate_limit_store = {}


def _check_rate_limit(key: str, max_attempts: int = 5, window_seconds: int = 300):
    """Check rate limit for a key (IP, user, etc.)

    Args:
        key: Unique identifier (e.g., "confirm:192.168.1.1")
        max_attempts: Maximum attempts allowed
        window_seconds: Time window in seconds

    Raises:
        HTTPException: If rate limit exceeded
    """
    now = datetime.utcnow()

    # Clean old entries
    if key in _rate_limit_store:
        _rate_limit_store[key] = [
            ts for ts in _rate_limit_store[key]
            if (now - ts).total_seconds() < window_seconds
        ]
    else:
        _rate_limit_store[key] = []

    # Check if limit exceeded
    if len(_rate_limit_store[key]) >= max_attempts:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Please try again in {window_seconds} seconds."
        )

    # Record this attempt
    _rate_limit_store[key].append(now)
