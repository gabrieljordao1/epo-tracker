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


@router.post("/epo/{token}/confirm")
async def vendor_confirm_epo(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    confirmation_number: Optional[str] = None,
    vendor_note: Optional[str] = None,
):
    """Vendor confirms an EPO. No auth required — token-based access."""
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
    client_ip = request.client.host if request.client else None
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

    logger.info(f"Vendor confirmed EPO #{epo.id} via portal (token={token[:8]}...)")

    return {
        "success": True,
        "message": "EPO confirmed successfully. Thank you!",
        "epo_id": epo.id,
        "new_status": "confirmed",
    }


@router.post("/epo/{token}/dispute")
async def vendor_dispute_epo(
    token: str,
    request: Request,
    session: AsyncSession = Depends(get_db),
    vendor_note: Optional[str] = None,
):
    """Vendor disputes an EPO. Flags for review."""
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
    client_ip = request.client.host if request.client else None
    action = VendorAction(
        epo_id=epo.id,
        company_id=epo.company_id,
        action_type="disputed",
        vendor_note=vendor_note,
        ip_address=client_ip,
    )
    session.add(action)
    await session.commit()

    logger.info(f"Vendor disputed EPO #{epo.id} via portal: {vendor_note}")

    return {
        "success": True,
        "message": "Your dispute has been submitted. The team will review it.",
        "epo_id": epo.id,
    }


@router.get("/epo/{token}/history")
async def get_epo_vendor_history(
    token: str,
    session: AsyncSession = Depends(get_db),
):
    """Get the action history for a vendor-facing EPO."""
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
