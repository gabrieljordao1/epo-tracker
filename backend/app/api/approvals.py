"""
EPO Approval Workflow API — superintendent sign-off before EPO goes to builder.
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import joinedload

from ..core.database import get_db
from ..core.auth import get_current_user
from ..core.security import audit_log
from ..models.models import User, EPO, EPOApproval, ApprovalStatus, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/approvals", tags=["approvals"])


class ApprovalRequest(BaseModel):
    epo_id: int
    note: Optional[str] = None


class ApprovalDecision(BaseModel):
    note: Optional[str] = None


@router.post("/request")
async def request_approval(
    req: ApprovalRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Field manager requests superintendent approval for an EPO."""
    try:
        # Verify EPO belongs to company
        result = await session.execute(
            select(EPO).where(EPO.id == req.epo_id, EPO.company_id == current_user.company_id)
        )
        epo = result.scalars().first()
        if not epo:
            raise HTTPException(status_code=404, detail="EPO not found")

        # Check no pending approval already exists
        existing = await session.execute(
            select(EPOApproval).where(
                EPOApproval.epo_id == req.epo_id,
                EPOApproval.status == ApprovalStatus.PENDING_SUPER,
            )
        )
        if existing.scalars().first():
            raise HTTPException(status_code=400, detail="Approval already pending for this EPO")

        # Create approval request
        approval = EPOApproval(
            epo_id=req.epo_id,
            company_id=current_user.company_id,
            requested_by_id=current_user.id,
            status=ApprovalStatus.PENDING_SUPER,
            note=req.note,
        )
        session.add(approval)

        # Update EPO approval status
        epo.approval_status = ApprovalStatus.PENDING_SUPER
        await session.commit()
        await session.refresh(approval)

        audit_log(
            event_type="approval_requested",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"epo_id": req.epo_id, "approval_id": approval.id}
        )

        return {
            "id": approval.id,
            "epo_id": req.epo_id,
            "status": approval.status.value,
            "requested_by": current_user.full_name,
            "note": approval.note,
            "created_at": approval.created_at.isoformat() if approval.created_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error requesting approval: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to request approval"
        )


@router.post("/{approval_id}/approve")
async def approve_epo(
    approval_id: int,
    decision: ApprovalDecision,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Manager/admin approves an EPO."""
    try:
        if current_user.role not in (UserRole.MANAGER, UserRole.ADMIN):
            raise HTTPException(status_code=403, detail="Only managers can approve EPOs")

        result = await session.execute(
            select(EPOApproval).where(
                EPOApproval.id == approval_id,
                EPOApproval.company_id == current_user.company_id,
            )
        )
        approval = result.scalars().first()
        if not approval:
            raise HTTPException(status_code=404, detail="Approval request not found")

        if approval.status != ApprovalStatus.PENDING_SUPER:
            raise HTTPException(status_code=400, detail="Approval already decided")

        # Approve
        approval.status = ApprovalStatus.APPROVED
        approval.approved_by_id = current_user.id
        approval.note = decision.note or approval.note
        approval.decided_at = datetime.utcnow()

        # Update EPO — always scope by company_id for tenant isolation
        epo_result = await session.execute(
            select(EPO).where(
                EPO.id == approval.epo_id,
                EPO.company_id == current_user.company_id,
            )
        )
        epo = epo_result.scalars().first()
        if not epo:
            logger.error(
                f"Data integrity: approval {approval.id} references EPO {approval.epo_id} "
                f"but it was not found in company {current_user.company_id}"
            )
            raise HTTPException(500, "Data integrity error — contact support")
        epo.approval_status = ApprovalStatus.APPROVED

        await session.commit()

        audit_log(
            event_type="approval_approved",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"approval_id": approval_id, "epo_id": approval.epo_id}
        )

        return {
            "id": approval.id,
            "epo_id": approval.epo_id,
            "status": "approved",
            "approved_by": current_user.full_name,
            "note": approval.note,
            "decided_at": approval.decided_at.isoformat() if approval.decided_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error approving EPO: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to approve EPO"
        )


@router.post("/{approval_id}/reject")
async def reject_epo(
    approval_id: int,
    decision: ApprovalDecision,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Manager/admin rejects an EPO."""
    try:
        if current_user.role not in (UserRole.MANAGER, UserRole.ADMIN):
            raise HTTPException(status_code=403, detail="Only managers can reject EPOs")

        result = await session.execute(
            select(EPOApproval).where(
                EPOApproval.id == approval_id,
                EPOApproval.company_id == current_user.company_id,
            )
        )
        approval = result.scalars().first()
        if not approval:
            raise HTTPException(status_code=404, detail="Approval request not found")

        if approval.status != ApprovalStatus.PENDING_SUPER:
            raise HTTPException(status_code=400, detail="Approval already decided")

        # Reject
        approval.status = ApprovalStatus.REJECTED
        approval.approved_by_id = current_user.id
        approval.note = decision.note or approval.note
        approval.decided_at = datetime.utcnow()

        # Update EPO — always scope by company_id for tenant isolation
        epo_result = await session.execute(
            select(EPO).where(
                EPO.id == approval.epo_id,
                EPO.company_id == current_user.company_id,
            )
        )
        epo = epo_result.scalars().first()
        if not epo:
            logger.error(
                f"Data integrity: approval {approval.id} references EPO {approval.epo_id} "
                f"but it was not found in company {current_user.company_id}"
            )
            raise HTTPException(500, "Data integrity error — contact support")
        epo.approval_status = ApprovalStatus.REJECTED

        await session.commit()

        audit_log(
            event_type="approval_rejected",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"approval_id": approval_id, "epo_id": approval.epo_id}
        )

        return {
            "id": approval.id,
            "epo_id": approval.epo_id,
            "status": "rejected",
            "rejected_by": current_user.full_name,
            "note": approval.note,
            "decided_at": approval.decided_at.isoformat() if approval.decided_at else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error rejecting EPO: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to reject EPO"
        )


@router.get("/pending")
async def get_pending_approvals(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get all pending approval requests for the company.
    Uses joinedload to fetch EPO and requestor in a single query (avoids N+1).
    """
    try:
        result = await session.execute(
            select(EPOApproval)
            .options(
                joinedload(EPOApproval.epo),
                joinedload(EPOApproval.requested_by),
            )
            .where(
                EPOApproval.company_id == current_user.company_id,
                EPOApproval.status == ApprovalStatus.PENDING_SUPER,
            )
            .order_by(EPOApproval.created_at.desc())
        )
        approvals = result.unique().scalars().all()

        items = []
        for a in approvals:
            epo = a.epo
            requestor = a.requested_by

            items.append({
                "id": a.id,
                "epo_id": a.epo_id,
                "status": a.status.value,
                "note": a.note,
                "requested_by": requestor.full_name if requestor else "Unknown",
                "created_at": a.created_at.isoformat() if a.created_at else None,
                "epo": {
                    "vendor_name": epo.vendor_name if epo else None,
                    "community": epo.community if epo else None,
                    "lot_number": epo.lot_number if epo else None,
                    "amount": epo.amount if epo else None,
                    "description": epo.description if epo else None,
                } if epo else None,
            })

        return {"approvals": items, "total": len(items)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving pending approvals: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve approvals"
        )
