"""
Team management endpoints.
Requires authentication — scoped to company.
"""

from typing import Optional
import logging
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..core.security import audit_log
from ..models.models import User, EPO, CommunityAssignment, EPOStatus, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/team", tags=["team"])


@router.get("/members")
async def get_team_members(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get all team members for the current user's company with their community assignments and EPO stats.

    Authorization:
    - ADMIN/MANAGER: See all team members with full details (email, stats, health)
    - FIELD: See team members' names only (no email, stats, or health info)
    """
    try:
        # Check authorization
        if current_user.role == UserRole.FIELD:
            # FIELD users can only see names, not email or stats
            company_id = current_user.company_id
            result = await session.execute(
                select(User).where(User.is_active.is_(True), User.company_id == company_id)
            )
            users = result.scalars().all()

            members = [
                {
                    "id": user.id,
                    "full_name": user.full_name,
                    "role": user.role.value if hasattr(user.role, 'value') else user.role,
                }
                for user in users
            ]

            audit_log(
                event_type="team_members_viewed",
                user_id=str(current_user.id),
                email=current_user.email,
                status="success",
                details={"role": "field", "members_count": len(members)}
            )
            return {"members": members, "total": len(members)}

        # ADMIN/MANAGER: See full details
        company_id = current_user.company_id
        result = await session.execute(
            select(User).where(User.is_active.is_(True), User.company_id == company_id)
        )
        users = result.scalars().all()

        members = []
        for user in users:
            # Get assigned communities (scoped to company)
            assign_result = await session.execute(
                select(CommunityAssignment.community_name)
                .where(
                    CommunityAssignment.supervisor_id == user.id,
                    CommunityAssignment.company_id == company_id,
                )
            )
            communities = [row[0] for row in assign_result.all()]

            # Get EPO stats for this supervisor's communities
            if communities:
                epo_query = select(EPO).where(
                    EPO.company_id == company_id,
                    EPO.community.in_(communities),
                )
            elif user.role == UserRole.ADMIN:
                epo_query = select(EPO).where(EPO.company_id == company_id)
            else:
                epo_query = select(EPO).where(
                    EPO.company_id == company_id,
                    EPO.created_by_id == user.id,
                )

            epo_result = await session.execute(epo_query)
            epos = epo_result.scalars().all()

            total = len(epos)
            confirmed = sum(1 for e in epos if e.status == EPOStatus.CONFIRMED)
            pending = sum(1 for e in epos if e.status == EPOStatus.PENDING)
            denied = sum(1 for e in epos if e.status == EPOStatus.DENIED)
            total_value = sum(e.amount or 0 for e in epos)
            overdue = sum(1 for e in epos if e.status == EPOStatus.PENDING and (e.days_open or 0) >= 7)
            needs_followup = sum(1 for e in epos if e.status == EPOStatus.PENDING and (e.days_open or 0) >= 4)

            # Health status: green/amber/red
            if overdue > 0:
                health = "red"
            elif needs_followup > 0:
                health = "amber"
            else:
                health = "green"

            members.append({
                "id": user.id,
                "full_name": user.full_name,
                "email": user.email,
                "role": user.role.value if hasattr(user.role, 'value') else user.role,
                "communities": communities,
                "stats": {
                    "total": total,
                    "confirmed": confirmed,
                    "pending": pending,
                    "denied": denied,
                    "total_value": round(total_value, 2),
                    "capture_rate": round(confirmed / total * 100) if total else 0,
                    "needs_followup": needs_followup,
                    "overdue": overdue,
                },
                "health": health,
            })

        audit_log(
            event_type="team_members_viewed",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"role": current_user.role.value if hasattr(current_user.role, 'value') else current_user.role, "members_count": len(members)}
        )
        return {"members": members, "total": len(members)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving team members: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve team members"
        )


@router.get("/members/{user_id}/epos")
async def get_supervisor_epos(
    user_id: int,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get EPOs for a specific supervisor (filtered by their communities).

    Authorization:
    - ADMIN/MANAGER: Can view EPOs for any team member
    - FIELD: Cannot access this endpoint
    """
    try:
        # Authorization check
        if current_user.role == UserRole.FIELD:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Field users cannot access team EPO data"
            )

        company_id = current_user.company_id

        # Verify the user belongs to same company
        target_result = await session.execute(
            select(User).where(User.id == user_id, User.company_id == company_id)
        )
        target_user = target_result.scalars().first()
        if not target_user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

        # Get supervisor's assigned communities
        assign_result = await session.execute(
            select(CommunityAssignment.community_name)
            .where(
                CommunityAssignment.supervisor_id == user_id,
                CommunityAssignment.company_id == company_id,
            )
        )
        communities = [row[0] for row in assign_result.all()]

        if communities:
            query = select(EPO).where(
                EPO.company_id == company_id,
                EPO.community.in_(communities),
            )
        else:
            query = select(EPO).where(
                EPO.company_id == company_id,
                EPO.created_by_id == user_id,
            )

        if status and status != "all":
            query = query.where(EPO.status == status)

        query = query.order_by(EPO.created_at.desc())
        result = await session.execute(query)
        epos = result.scalars().all()

        return {
            "epos": [
                {
                    "id": e.id,
                    "vendor_name": e.vendor_name,
                    "vendor_email": e.vendor_email,
                    "community": e.community,
                    "lot_number": e.lot_number,
                    "description": e.description,
                    "amount": e.amount,
                    "status": e.status.value if hasattr(e.status, 'value') else e.status,
                    "confirmation_number": e.confirmation_number,
                    "days_open": e.days_open,
                    "needs_review": e.needs_review,
                    "confidence_score": e.confidence_score,
                    "parse_model": e.parse_model,
                    "created_at": e.created_at.isoformat() if e.created_at else None,
                }
                for e in epos
            ],
            "total": len(epos),
            "supervisor_id": user_id,
            "communities": communities,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving EPOs for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve EPOs"
        )


@router.get("/members/{user_id}/stats")
async def get_supervisor_stats(
    user_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get stats for a specific supervisor.

    Authorization:
    - ADMIN/MANAGER: Can view stats for any team member
    - FIELD: Cannot access this endpoint
    """
    try:
        # Authorization check
        if current_user.role == UserRole.FIELD:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Field users cannot access team stats"
            )

        company_id = current_user.company_id

        # Verify the target user belongs to the same company
        target_user_result = await session.execute(
            select(User).where(User.id == user_id, User.company_id == company_id)
        )
        if not target_user_result.scalars().first():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Team member not found"
            )

        assign_result = await session.execute(
            select(CommunityAssignment.community_name)
            .where(
                CommunityAssignment.supervisor_id == user_id,
                CommunityAssignment.company_id == company_id,
            )
        )
        communities = [row[0] for row in assign_result.all()]

        if communities:
            query = select(EPO).where(
                EPO.company_id == company_id,
                EPO.community.in_(communities),
            )
        else:
            query = select(EPO).where(
                EPO.company_id == company_id,
                EPO.created_by_id == user_id,
            )

        result = await session.execute(query)
        epos = result.scalars().all()

        total = len(epos)
        confirmed = sum(1 for e in epos if e.status == EPOStatus.CONFIRMED)
        pending = sum(1 for e in epos if e.status == EPOStatus.PENDING)
        denied = sum(1 for e in epos if e.status == EPOStatus.DENIED)
        discount = sum(1 for e in epos if e.status == EPOStatus.DISCOUNT)
        total_value = sum(e.amount or 0 for e in epos)
        needs_followup = sum(1 for e in epos if e.status == EPOStatus.PENDING and (e.days_open or 0) >= 4)

        return {
            "total": total,
            "confirmed": confirmed,
            "pending": pending,
            "denied": denied,
            "discount": discount,
            "total_value": round(total_value, 2),
            "capture_rate": round(confirmed / total * 100) if total else 0,
            "needs_followup": needs_followup,
            "avg_amount": round(total_value / total, 2) if total else 0,
            "communities": communities,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving stats for user {user_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve user stats"
        )
