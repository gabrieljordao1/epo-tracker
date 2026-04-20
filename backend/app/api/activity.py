"""
Activity feed — recent EPO events and vendor actions.
"""

import logging
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, EPO, EPOFollowup, EPOStatus, UserRole

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/activity", tags=["activity"])


@router.get("/feed")
async def get_activity_feed(
    limit: int = Query(20, ge=1, le=100),
    days: int = Query(7, ge=1, le=90),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get recent activity feed for the company dashboard.
    Field role users only see activity for their own EPOs.
    """
    since = datetime.utcnow() - timedelta(days=days)
    company_id = current_user.company_id
    is_field = current_user.role == UserRole.FIELD

    # Get recent EPOs
    epo_filters = [EPO.company_id == company_id, EPO.created_at >= since]
    if is_field:
        epo_filters.append(EPO.created_by_id == current_user.id)

    epo_query = select(EPO).where(
        and_(*epo_filters)
    ).order_by(EPO.created_at.desc()).limit(limit)

    epo_result = await session.execute(epo_query)
    recent_epos = epo_result.scalars().all()

    # Get recent followups (scope to user's EPOs for field users)
    followup_filters = [EPOFollowup.company_id == company_id, EPOFollowup.created_at >= since]
    if is_field:
        # Only show followups for EPOs the field user created
        user_epo_ids = select(EPO.id).where(
            and_(EPO.company_id == company_id, EPO.created_by_id == current_user.id)
        )
        followup_filters.append(EPOFollowup.epo_id.in_(user_epo_ids))

    followup_query = select(EPOFollowup).where(
        and_(*followup_filters)
    ).order_by(EPOFollowup.created_at.desc()).limit(limit)

    followup_result = await session.execute(followup_query)
    recent_followups = followup_result.scalars().all()

    # Build unified feed
    feed = []

    for epo in recent_epos:
        feed.append({
            "type": "epo_created",
            "timestamp": epo.created_at.isoformat() if epo.created_at else None,
            "title": f"New EPO from {epo.vendor_name}",
            "description": f"{epo.community} Lot {epo.lot_number} — ${epo.amount:,.2f}" if epo.amount else f"{epo.community} Lot {epo.lot_number}",
            "status": epo.status.value if hasattr(epo.status, 'value') else epo.status,
            "epo_id": epo.id,
            "icon": "inbox",
        })

    for fu in recent_followups:
        feed.append({
            "type": "followup_sent",
            "timestamp": fu.created_at.isoformat() if fu.created_at else None,
            "title": f"Follow-up sent to {fu.sent_to_email}",
            "description": fu.subject,
            "status": fu.status.value if hasattr(fu.status, 'value') else fu.status,
            "epo_id": fu.epo_id,
            "icon": "mail",
        })

    # Sort by timestamp descending
    feed.sort(key=lambda x: x["timestamp"] or "", reverse=True)

    return {
        "feed": feed[:limit],
        "total": len(feed),
        "period_days": days,
    }


@router.get("/stats/today")
async def get_today_stats(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Quick stats for today's activity.
    Field role users only see stats for their own EPOs.
    """
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    company_id = current_user.company_id
    is_field = current_user.role == UserRole.FIELD

    # Today's EPOs
    today_filters = [EPO.company_id == company_id, EPO.created_at >= today_start]
    if is_field:
        today_filters.append(EPO.created_by_id == current_user.id)

    today_query = select(EPO).where(and_(*today_filters))
    today_result = await session.execute(today_query)
    today_epos = today_result.scalars().all()

    # Pending needing attention
    attention_filters = [
        EPO.company_id == company_id,
        EPO.status == EPOStatus.PENDING,
        EPO.days_open >= 4,
    ]
    if is_field:
        attention_filters.append(EPO.created_by_id == current_user.id)

    attention_query = select(EPO).where(and_(*attention_filters))
    attention_result = await session.execute(attention_query)
    needs_attention = attention_result.scalars().all()

    return {
        "today_new": len(today_epos),
        "today_value": round(sum(e.amount or 0 for e in today_epos), 2),
        "needs_attention": len(needs_attention),
        "needs_attention_value": round(sum(e.amount or 0 for e in needs_attention), 2),
    }
