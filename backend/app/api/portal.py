"""
Portal Status API — track BuildPro/SupplyPro EPO approval status.
Until API integration is available, supports manual status updates.
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, EPO, PortalStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/portal", tags=["portal"])


class PortalStatusUpdate(BaseModel):
    portal_status: str  # requested, pending_approval, approved, rejected, partially_approved
    portal_confirmation_number: Optional[str] = None
    portal_source: Optional[str] = "manual"  # buildpro, supplypro, manual
    portal_notes: Optional[str] = None


@router.put("/epo/{epo_id}/status")
async def update_portal_status(
    epo_id: int,
    update: PortalStatusUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Manually update the BuildPro/SupplyPro portal status for an EPO."""
    result = await session.execute(
        select(EPO).where(EPO.id == epo_id, EPO.company_id == current_user.company_id)
    )
    epo = result.scalars().first()
    if not epo:
        raise HTTPException(status_code=404, detail="EPO not found")

    # Validate portal status
    try:
        status_enum = PortalStatus(update.portal_status)
    except ValueError:
        valid = [s.value for s in PortalStatus]
        raise HTTPException(
            status_code=400,
            detail=f"Invalid portal status. Valid: {', '.join(valid)}",
        )

    old_status = epo.portal_status.value if epo.portal_status else "unknown"

    epo.portal_status = status_enum
    epo.portal_checked_at = datetime.utcnow()

    if update.portal_confirmation_number:
        epo.portal_confirmation_number = update.portal_confirmation_number
    if update.portal_source:
        epo.portal_source = update.portal_source
    if update.portal_notes:
        epo.portal_notes = update.portal_notes

    await session.commit()

    logger.info(
        f"Portal status updated: EPO {epo_id} {old_status} → {status_enum.value} "
        f"(source={update.portal_source}, user={current_user.id})"
    )

    return {
        "epo_id": epo_id,
        "portal_status": status_enum.value,
        "portal_confirmation_number": epo.portal_confirmation_number,
        "portal_source": epo.portal_source,
        "portal_notes": epo.portal_notes,
        "portal_checked_at": epo.portal_checked_at.isoformat() if epo.portal_checked_at else None,
        "message": f"Portal status updated to {status_enum.value}",
    }


@router.get("/epo/{epo_id}/status")
async def get_portal_status(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get the current portal status for an EPO."""
    result = await session.execute(
        select(EPO).where(EPO.id == epo_id, EPO.company_id == current_user.company_id)
    )
    epo = result.scalars().first()
    if not epo:
        raise HTTPException(status_code=404, detail="EPO not found")

    return {
        "epo_id": epo_id,
        "portal_status": epo.portal_status.value if epo.portal_status else "unknown",
        "portal_confirmation_number": epo.portal_confirmation_number,
        "portal_source": epo.portal_source,
        "portal_notes": epo.portal_notes,
        "portal_checked_at": epo.portal_checked_at.isoformat() if epo.portal_checked_at else None,
    }


@router.get("/summary")
async def get_portal_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get summary of portal statuses across all EPOs for the company."""
    from sqlalchemy import func

    result = await session.execute(
        select(EPO.portal_status, func.count(EPO.id))
        .where(EPO.company_id == current_user.company_id)
        .group_by(EPO.portal_status)
    )
    counts = {row[0].value if row[0] else "unknown": row[1] for row in result.all()}

    # Get EPOs that need portal checking (status is unknown or requested)
    needs_check = await session.execute(
        select(EPO)
        .where(
            EPO.company_id == current_user.company_id,
            EPO.portal_status.in_([PortalStatus.UNKNOWN, PortalStatus.REQUESTED]),
            EPO.status == "confirmed",  # Only check confirmed EPOs
        )
        .order_by(EPO.created_at.desc())
        .limit(20)
    )
    epos_needing_check = needs_check.scalars().all()

    return {
        "status_counts": counts,
        "needs_portal_check": [
            {
                "id": e.id,
                "vendor_name": e.vendor_name,
                "community": e.community,
                "lot_number": e.lot_number,
                "amount": e.amount,
                "confirmation_number": e.confirmation_number,
                "portal_status": e.portal_status.value if e.portal_status else "unknown",
                "days_open": e.days_open,
            }
            for e in epos_needing_check
        ],
        "total_needing_check": len(epos_needing_check),
    }
