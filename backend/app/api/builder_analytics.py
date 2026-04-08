from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, and_, case, desc, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timedelta
import logging

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, EPO, EPOStatus, UserRole
from ..models.schemas import DashboardStats

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


# ─── Response Models ───────────────────────────────────────────────────────


class BuilderScorecard:
    """Builder/vendor scorecard response"""
    vendor_name: str
    vendor_email: str
    total_epos: int
    confirmed_count: int
    denied_count: int
    pending_count: int
    discount_count: int
    total_value: float
    confirmed_value: float
    capture_rate: float  # percentage
    avg_response_days: Optional[float]
    last_epo_date: Optional[datetime]
    trend: str  # "up", "down", "stable"


class CommunityAnalytics:
    """Community-level analytics"""
    community_name: str
    total_epos: int
    confirmed: int
    pending: int
    denied: int
    total_value: float
    confirmed_value: float
    top_vendor: Optional[str]
    avg_days_open: Optional[float]


class TrendPoint:
    """Time-series trend point"""
    week: str  # ISO week format: "2026-W14"
    new_count: int
    confirmed_count: int
    denied_count: int
    total_value: float


# ─── Helper Functions ──────────────────────────────────────────────────────


async def get_company_id(
    current_user: User = Depends(get_current_user),
) -> int:
    """Extract company_id from current user"""
    return current_user.company_id


async def apply_role_filter(
    current_user: User,
    base_query,
    session: AsyncSession,
):
    """Apply EPO visibility filter based on user role"""
    if current_user.role == UserRole.FIELD:
        # FIELD users only see EPOs they created
        return base_query.where(EPO.created_by_id == current_user.id)
    else:
        # ADMIN/MANAGER see all company EPOs
        return base_query.where(EPO.company_id == current_user.company_id)


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.get("/builders")
async def get_builder_scorecards(
    sort_by: Optional[str] = Query("value", pattern="^(value|count|rate|response_time)$"),
    days: int = Query(90, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get builder (vendor) scorecards with performance metrics.

    Query Parameters:
    - sort_by: "value" (default), "count", "rate", "response_time"
    - days: Number of days to look back (default 90, max 365)

    Returns:
    - vendor_name, vendor_email
    - total_epos, confirmed_count, denied_count, pending_count, discount_count
    - total_value, confirmed_value
    - capture_rate (confirmed/total as percentage)
    - avg_response_days (average days_open for resolved EPOs)
    - last_epo_date
    - trend (compare last 30 days vs previous 30 days: "up", "down", "stable")
    """
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days)

        # Base query for EPOs in date range
        base_query = select(EPO).where(
            and_(
                EPO.company_id == current_user.company_id,
                EPO.created_at >= cutoff_date,
            )
        )

        # Apply role-based filtering
        if current_user.role == UserRole.FIELD:
            base_query = base_query.where(EPO.created_by_id == current_user.id)

        result = await session.execute(base_query)
        epos = result.scalars().all()

        if not epos:
            return []

        # Group by vendor and calculate metrics
        vendor_metrics = {}

        for epo in epos:
            vendor_key = (epo.vendor_name, epo.vendor_email)

            if vendor_key not in vendor_metrics:
                vendor_metrics[vendor_key] = {
                    "vendor_name": epo.vendor_name,
                    "vendor_email": epo.vendor_email,
                    "total_epos": 0,
                    "confirmed_count": 0,
                    "denied_count": 0,
                    "pending_count": 0,
                    "discount_count": 0,
                    "total_value": 0.0,
                    "confirmed_value": 0.0,
                    "response_days": [],
                    "last_epo_date": None,
                    "last_30_count": 0,
                    "prev_30_count": 0,
                }

            metrics = vendor_metrics[vendor_key]
            metrics["total_epos"] += 1

            if epo.status == EPOStatus.CONFIRMED:
                metrics["confirmed_count"] += 1
                if epo.amount:
                    metrics["confirmed_value"] += epo.amount
            elif epo.status == EPOStatus.DENIED:
                metrics["denied_count"] += 1
            elif epo.status == EPOStatus.PENDING:
                metrics["pending_count"] += 1
            elif epo.status == EPOStatus.DISCOUNT:
                metrics["discount_count"] += 1

            if epo.amount:
                metrics["total_value"] += epo.amount

            # Track response time for resolved EPOs
            if epo.days_open is not None and epo.status != EPOStatus.PENDING:
                metrics["response_days"].append(epo.days_open)

            # Update last EPO date
            if metrics["last_epo_date"] is None or epo.created_at > metrics["last_epo_date"]:
                metrics["last_epo_date"] = epo.created_at

            # Track for trend calculation (last 30 vs previous 30)
            now = datetime.utcnow()
            thirty_days_ago = now - timedelta(days=30)
            sixty_days_ago = now - timedelta(days=60)

            if epo.created_at >= thirty_days_ago:
                metrics["last_30_count"] += 1
            elif epo.created_at >= sixty_days_ago:
                metrics["prev_30_count"] += 1

        # Build response list with calculated metrics
        results = []
        for (vendor_name, vendor_email), metrics in vendor_metrics.items():
            total = metrics["total_epos"]
            confirmed = metrics["confirmed_count"]
            capture_rate = (confirmed / total * 100) if total > 0 else 0.0

            avg_response_days = None
            if metrics["response_days"]:
                avg_response_days = sum(metrics["response_days"]) / len(metrics["response_days"])

            # Calculate trend
            trend = "stable"
            if metrics["last_30_count"] > metrics["prev_30_count"] * 1.1:
                trend = "up"
            elif metrics["last_30_count"] < metrics["prev_30_count"] * 0.9:
                trend = "down"

            results.append({
                "vendor_name": vendor_name,
                "vendor_email": vendor_email,
                "total_epos": total,
                "confirmed_count": confirmed,
                "denied_count": metrics["denied_count"],
                "pending_count": metrics["pending_count"],
                "discount_count": metrics["discount_count"],
                "total_value": round(metrics["total_value"], 2),
                "confirmed_value": round(metrics["confirmed_value"], 2),
                "capture_rate": round(capture_rate, 2),
                "avg_response_days": round(avg_response_days, 2) if avg_response_days else None,
                "last_epo_date": metrics["last_epo_date"],
                "trend": trend,
            })

        # Sort results based on sort_by parameter
        if sort_by == "count":
            results.sort(key=lambda x: x["total_epos"], reverse=True)
        elif sort_by == "rate":
            results.sort(key=lambda x: x["capture_rate"], reverse=True)
        elif sort_by == "response_time":
            results.sort(
                key=lambda x: x["avg_response_days"] if x["avg_response_days"] else float('inf')
            )
        else:  # default "value"
            results.sort(key=lambda x: x["total_value"], reverse=True)

        return results

    except Exception as e:
        logger.error(f"Error fetching builder scorecards: {str(e)}")
        raise


@router.get("/communities")
async def get_community_analytics(
    days: int = Query(90, ge=1, le=365),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get community-level analytics.

    Query Parameters:
    - days: Number of days to look back (default 90, max 365)

    Returns:
    - community_name
    - total_epos, confirmed, pending, denied
    - total_value, confirmed_value
    - top_vendor (most EPOs from which vendor)
    - avg_days_open
    """
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=days)

        # Base query for EPOs in date range
        base_query = select(EPO).where(
            and_(
                EPO.company_id == current_user.company_id,
                EPO.created_at >= cutoff_date,
            )
        )

        # Apply role-based filtering
        if current_user.role == UserRole.FIELD:
            base_query = base_query.where(EPO.created_by_id == current_user.id)

        result = await session.execute(base_query)
        epos = result.scalars().all()

        if not epos:
            return []

        # Group by community
        community_metrics = {}

        for epo in epos:
            # Skip EPOs without a community
            if not epo.community:
                continue

            community_name = epo.community

            if community_name not in community_metrics:
                community_metrics[community_name] = {
                    "community_name": community_name,
                    "total_epos": 0,
                    "confirmed": 0,
                    "pending": 0,
                    "denied": 0,
                    "total_value": 0.0,
                    "confirmed_value": 0.0,
                    "vendors": {},
                    "days_open_list": [],
                }

            metrics = community_metrics[community_name]
            metrics["total_epos"] += 1

            if epo.status == EPOStatus.CONFIRMED:
                metrics["confirmed"] += 1
                if epo.amount:
                    metrics["confirmed_value"] += epo.amount
            elif epo.status == EPOStatus.PENDING:
                metrics["pending"] += 1
            elif epo.status == EPOStatus.DENIED:
                metrics["denied"] += 1

            if epo.amount:
                metrics["total_value"] += epo.amount

            # Track vendors for top_vendor calculation
            vendor_name = epo.vendor_name
            if vendor_name not in metrics["vendors"]:
                metrics["vendors"][vendor_name] = 0
            metrics["vendors"][vendor_name] += 1

            # Track days open
            if epo.days_open is not None:
                metrics["days_open_list"].append(epo.days_open)

        # Build response list
        results = []
        for community_name, metrics in community_metrics.items():
            # Find top vendor
            top_vendor = None
            if metrics["vendors"]:
                top_vendor = max(metrics["vendors"].items(), key=lambda x: x[1])[0]

            # Calculate average days open
            avg_days_open = None
            if metrics["days_open_list"]:
                avg_days_open = sum(metrics["days_open_list"]) / len(metrics["days_open_list"])

            results.append({
                "community_name": community_name,
                "total_epos": metrics["total_epos"],
                "confirmed": metrics["confirmed"],
                "pending": metrics["pending"],
                "denied": metrics["denied"],
                "total_value": round(metrics["total_value"], 2),
                "confirmed_value": round(metrics["confirmed_value"], 2),
                "top_vendor": top_vendor,
                "avg_days_open": round(avg_days_open, 2) if avg_days_open else None,
            })

        # Sort by total EPOs descending
        results.sort(key=lambda x: x["total_epos"], reverse=True)

        return results

    except Exception as e:
        logger.error(f"Error fetching community analytics: {str(e)}")
        raise


@router.get("/trends")
async def get_trends(
    weeks: int = Query(12, ge=4, le=52),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get time-series trend data for charts.

    Query Parameters:
    - weeks: Number of weeks to return (default 12, max 52)

    Returns:
    - Array of {week: "2026-W14", new_count, confirmed_count, denied_count, total_value}
    """
    try:
        # Calculate date range
        now = datetime.utcnow()
        cutoff_date = now - timedelta(weeks=weeks)

        # Base query for EPOs in date range
        base_query = select(EPO).where(
            and_(
                EPO.company_id == current_user.company_id,
                EPO.created_at >= cutoff_date,
            )
        )

        # Apply role-based filtering
        if current_user.role == UserRole.FIELD:
            base_query = base_query.where(EPO.created_by_id == current_user.id)

        result = await session.execute(base_query)
        epos = result.scalars().all()

        # Initialize trend data structure (one entry per week)
        trend_data = {}

        # Generate week keys for the entire period
        current_date = cutoff_date
        while current_date <= now:
            week_key = current_date.strftime("%Y-W%W")
            if week_key not in trend_data:
                trend_data[week_key] = {
                    "week": week_key,
                    "new_count": 0,
                    "confirmed_count": 0,
                    "denied_count": 0,
                    "total_value": 0.0,
                }
            current_date += timedelta(days=7)

        # Process each EPO
        for epo in epos:
            week_key = epo.created_at.strftime("%Y-W%W")

            # Skip if week is outside our range (shouldn't happen but safety check)
            if week_key not in trend_data:
                continue

            trend_data[week_key]["new_count"] += 1

            if epo.status == EPOStatus.CONFIRMED:
                trend_data[week_key]["confirmed_count"] += 1
            elif epo.status == EPOStatus.DENIED:
                trend_data[week_key]["denied_count"] += 1

            if epo.amount:
                trend_data[week_key]["total_value"] += epo.amount

        # Convert to list and round values
        results = []
        for week_key in sorted(trend_data.keys()):
            data = trend_data[week_key]
            results.append({
                "week": data["week"],
                "new_count": data["new_count"],
                "confirmed_count": data["confirmed_count"],
                "denied_count": data["denied_count"],
                "total_value": round(data["total_value"], 2),
            })

        return results

    except Exception as e:
        logger.error(f"Error fetching trends: {str(e)}")
        raise
