from fastapi import APIRouter, Depends, Query, HTTPException, status as http_status
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import logging

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, CommunityBudget, EPO, EPOStatus, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


# ─── Response Models ───────────────────────────────────────────────────────


def _serialize_budget(budget: CommunityBudget) -> dict:
    """Convert CommunityBudget model to dict for JSON response"""
    return {
        "id": budget.id,
        "company_id": budget.company_id,
        "created_by_id": budget.created_by_id,
        "community": budget.community,
        "budget_amount": budget.budget_amount,
        "period_start": budget.period_start,
        "period_end": budget.period_end,
        "labor_budget": budget.labor_budget,
        "materials_budget": budget.materials_budget,
        "equipment_budget": budget.equipment_budget,
        "notes": budget.notes,
        "is_active": budget.is_active,
        "created_at": budget.created_at,
        "updated_at": budget.updated_at,
    }


# ─── Helper Functions ──────────────────────────────────────────────────────


async def _check_budget_access(
    budget_id: int,
    current_user: User,
    session: AsyncSession,
) -> CommunityBudget:
    """Check if user has access to a budget"""
    result = await session.execute(
        select(CommunityBudget).where(CommunityBudget.id == budget_id)
    )
    budget = result.scalars().first()

    if not budget:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Budget not found")

    # Check company access
    if budget.company_id != current_user.company_id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    return budget


async def _get_actual_spend(
    company_id: int,
    community: str,
    period_start: datetime,
    period_end: datetime,
    session: AsyncSession,
) -> dict:
    """
    Calculate actual spend for a community in a budget period.
    Returns: {actual_spend: float, epo_count: int, epos_by_month: []}
    """
    result = await session.execute(
        select(EPO).where(
            and_(
                EPO.company_id == company_id,
                EPO.community == community,
                EPO.status == EPOStatus.CONFIRMED,
                EPO.created_at >= period_start,
                EPO.created_at <= period_end,
            )
        )
    )
    epos = result.scalars().all()

    actual_spend = sum(epo.amount or 0.0 for epo in epos)
    epo_count = len(epos)

    return {
        "actual_spend": actual_spend,
        "epo_count": epo_count,
        "epos": epos,
    }


def _calculate_budget_status(percent_used: float) -> str:
    """Determine budget status based on percent used"""
    if percent_used > 100:
        return "exceeded"
    elif percent_used > 90:
        return "over_budget"
    elif percent_used >= 75:
        return "warning"
    else:
        return "on_track"


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/")
async def create_budget(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Create a community budget.

    Request body:
    - community: str (required)
    - budget_amount: float > 0 (required)
    - period_start: ISO datetime (required)
    - period_end: ISO datetime (required, must be > period_start)
    - labor_budget: float (optional)
    - materials_budget: float (optional)
    - equipment_budget: float (optional)
    - notes: str (optional)

    Only ADMIN/MANAGER can create budgets.
    """
    try:
        # Role check
        if current_user.role == UserRole.FIELD:
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only admins and managers can create budgets",
            )

        # Validate required fields
        required_fields = ["community", "budget_amount", "period_start", "period_end"]
        if not all(field in data for field in required_fields):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail=f"Required fields: {', '.join(required_fields)}",
            )

        # Validate budget_amount
        budget_amount = data["budget_amount"]
        if budget_amount <= 0:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="budget_amount must be greater than 0",
            )

        # Parse and validate dates
        try:
            period_start = data["period_start"]
            if isinstance(period_start, str):
                period_start = datetime.fromisoformat(period_start.replace("Z", "+00:00"))
            if period_start.tzinfo is None:
                period_start = period_start.replace(tzinfo=timezone.utc)

            period_end = data["period_end"]
            if isinstance(period_end, str):
                period_end = datetime.fromisoformat(period_end.replace("Z", "+00:00"))
            if period_end.tzinfo is None:
                period_end = period_end.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Invalid date format for period_start or period_end",
            )

        # Validate period_start < period_end
        if period_start >= period_end:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="period_start must be before period_end",
            )

        # Create budget
        budget = CommunityBudget(
            company_id=current_user.company_id,
            created_by_id=current_user.id,
            community=data["community"],
            budget_amount=budget_amount,
            period_start=period_start,
            period_end=period_end,
            labor_budget=data.get("labor_budget"),
            materials_budget=data.get("materials_budget"),
            equipment_budget=data.get("equipment_budget"),
            notes=data.get("notes"),
            is_active=True,
        )

        session.add(budget)
        await session.commit()
        await session.refresh(budget)

        logger.info(f"Budget {budget.id} created by user {current_user.id} for company {current_user.company_id}")
        return _serialize_budget(budget)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating budget: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error creating budget")


@router.get("/")
async def list_budgets(
    community: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    List all active budgets with calculated actual spend.

    Query Parameters:
    - community: Filter by community name (optional)
    - is_active: Filter by active status (default: true)

    Returns budgets with calculated actual_spend for each budget period.
    """
    try:
        # Build base query
        query = select(CommunityBudget).where(CommunityBudget.company_id == current_user.company_id)

        # Filter by active status
        if is_active is not None:
            query = query.where(CommunityBudget.is_active == is_active)

        # Filter by community if provided
        if community:
            query = query.where(CommunityBudget.community.ilike(f"%{community}%"))

        # Sort by community name
        query = query.order_by(CommunityBudget.community)

        result = await session.execute(query)
        budgets = result.scalars().all()

        # Build response with actual spend calculated
        response = []
        for budget in budgets:
            actual_data = await _get_actual_spend(
                budget.company_id,
                budget.community,
                budget.period_start,
                budget.period_end,
                session,
            )

            remaining = budget.budget_amount - actual_data["actual_spend"]
            percent_used = (actual_data["actual_spend"] / budget.budget_amount * 100) if budget.budget_amount > 0 else 0

            budget_dict = _serialize_budget(budget)
            budget_dict.update({
                "actual_spend": round(actual_data["actual_spend"], 2),
                "remaining": round(remaining, 2),
                "percent_used": round(percent_used, 2),
                "epo_count": actual_data["epo_count"],
                "status": _calculate_budget_status(percent_used),
            })
            response.append(budget_dict)

        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing budgets: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving budgets")


@router.get("/{budget_id}")
async def get_budget(
    budget_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get a single budget with detailed actuals breakdown.
    """
    try:
        budget = await _check_budget_access(budget_id, current_user, session)

        actual_data = await _get_actual_spend(
            budget.company_id,
            budget.community,
            budget.period_start,
            budget.period_end,
            session,
        )

        remaining = budget.budget_amount - actual_data["actual_spend"]
        percent_used = (actual_data["actual_spend"] / budget.budget_amount * 100) if budget.budget_amount > 0 else 0

        budget_dict = _serialize_budget(budget)
        budget_dict.update({
            "actual_spend": round(actual_data["actual_spend"], 2),
            "remaining": round(remaining, 2),
            "percent_used": round(percent_used, 2),
            "epo_count": actual_data["epo_count"],
            "status": _calculate_budget_status(percent_used),
            "epos": [
                {
                    "id": epo.id,
                    "vendor_name": epo.vendor_name,
                    "description": epo.description,
                    "amount": epo.amount,
                    "created_at": epo.created_at,
                }
                for epo in actual_data["epos"]
            ],
        })

        return budget_dict

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving budget {budget_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving budget")


@router.put("/{budget_id}")
async def update_budget(
    budget_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Update a budget (ADMIN/MANAGER only).

    Updatable fields:
    - budget_amount (must be > 0)
    - period_start, period_end (period_start must be < period_end)
    - labor_budget, materials_budget, equipment_budget
    - notes
    - is_active
    """
    try:
        # Role check
        if current_user.role == UserRole.FIELD:
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only admins and managers can update budgets",
            )

        budget = await _check_budget_access(budget_id, current_user, session)

        # Update budget_amount
        if "budget_amount" in data:
            if data["budget_amount"] <= 0:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="budget_amount must be greater than 0",
                )
            budget.budget_amount = data["budget_amount"]

        # Update period dates
        if "period_start" in data or "period_end" in data:
            period_start = budget.period_start
            period_end = budget.period_end

            if "period_start" in data:
                try:
                    period_start = data["period_start"]
                    if isinstance(period_start, str):
                        period_start = datetime.fromisoformat(period_start.replace("Z", "+00:00"))
                    if period_start.tzinfo is None:
                        period_start = period_start.replace(tzinfo=timezone.utc)
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid date format for period_start",
                    )

            if "period_end" in data:
                try:
                    period_end = data["period_end"]
                    if isinstance(period_end, str):
                        period_end = datetime.fromisoformat(period_end.replace("Z", "+00:00"))
                    if period_end.tzinfo is None:
                        period_end = period_end.replace(tzinfo=timezone.utc)
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid date format for period_end",
                    )

            # Validate dates
            if period_start >= period_end:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="period_start must be before period_end",
                )

            budget.period_start = period_start
            budget.period_end = period_end

        # Update optional fields
        if "labor_budget" in data:
            budget.labor_budget = data["labor_budget"]

        if "materials_budget" in data:
            budget.materials_budget = data["materials_budget"]

        if "equipment_budget" in data:
            budget.equipment_budget = data["equipment_budget"]

        if "notes" in data:
            budget.notes = data["notes"]

        if "is_active" in data:
            budget.is_active = data["is_active"]

        await session.commit()
        await session.refresh(budget)

        logger.info(f"Budget {budget_id} updated by user {current_user.id}")
        return _serialize_budget(budget)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating budget {budget_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error updating budget")


@router.delete("/{budget_id}")
async def delete_budget(
    budget_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Soft delete a budget (sets is_active=False).

    Only ADMIN can delete budgets.
    """
    try:
        # Role check
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(
                status_code=http_status.HTTP_403_FORBIDDEN,
                detail="Only admins can delete budgets",
            )

        budget = await _check_budget_access(budget_id, current_user, session)

        budget.is_active = False
        await session.commit()

        logger.info(f"Budget {budget_id} deleted (soft) by user {current_user.id}")
        return {"message": "Budget deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting budget {budget_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error deleting budget")


@router.get("/overview/dashboard")
async def get_budget_overview(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Main dashboard endpoint for budget tracking.

    Returns:
    - budgets: Array of community budgets with status
    - overall_totals: Aggregated budget/actual/remaining across all communities
    - unbudgeted_communities: Communities with EPO spend but no budget
    """
    try:
        # Get all active budgets for company
        result = await session.execute(
            select(CommunityBudget).where(
                and_(
                    CommunityBudget.company_id == current_user.company_id,
                    CommunityBudget.is_active == True,
                )
            )
        )
        budgets = result.scalars().all()

        budgets_list = []
        total_budget = 0.0
        total_actual = 0.0
        total_remaining = 0.0
        total_epos = 0

        for budget in budgets:
            actual_data = await _get_actual_spend(
                budget.company_id,
                budget.community,
                budget.period_start,
                budget.period_end,
                session,
            )

            remaining = budget.budget_amount - actual_data["actual_spend"]
            percent_used = (actual_data["actual_spend"] / budget.budget_amount * 100) if budget.budget_amount > 0 else 0

            budgets_list.append({
                "id": budget.id,
                "community": budget.community,
                "budget_amount": round(budget.budget_amount, 2),
                "actual_spend": round(actual_data["actual_spend"], 2),
                "remaining": round(remaining, 2),
                "percent_used": round(percent_used, 2),
                "epo_count": actual_data["epo_count"],
                "status": _calculate_budget_status(percent_used),
                "period_start": budget.period_start,
                "period_end": budget.period_end,
            })

            total_budget += budget.budget_amount
            total_actual += actual_data["actual_spend"]
            total_remaining += remaining
            total_epos += actual_data["epo_count"]

        # Find unbudgeted communities (have EPOs but no budget)
        result = await session.execute(
            select(func.distinct(EPO.community)).where(
                and_(
                    EPO.company_id == current_user.company_id,
                    EPO.status == EPOStatus.CONFIRMED,
                    EPO.community.isnot(None),
                )
            )
        )
        all_communities_with_epos = set(row[0] for row in result.fetchall() if row[0])

        budgeted_communities = set(budget.community for budget in budgets)
        unbudgeted_communities_list = []

        for community in all_communities_with_epos - budgeted_communities:
            # Get spend for this community (no time period restriction for unbudgeted)
            result = await session.execute(
                select(func.sum(EPO.amount)).where(
                    and_(
                        EPO.company_id == current_user.company_id,
                        EPO.community == community,
                        EPO.status == EPOStatus.CONFIRMED,
                    )
                )
            )
            community_spend = result.scalar() or 0.0

            result = await session.execute(
                select(func.count(EPO.id)).where(
                    and_(
                        EPO.company_id == current_user.company_id,
                        EPO.community == community,
                        EPO.status == EPOStatus.CONFIRMED,
                    )
                )
            )
            community_epo_count = result.scalar() or 0

            unbudgeted_communities_list.append({
                "community": community,
                "actual_spend": round(community_spend, 2),
                "epo_count": community_epo_count,
                "status": "unbudgeted",
            })

        total_percent = (total_actual / total_budget * 100) if total_budget > 0 else 0

        return {
            "budgets": budgets_list,
            "overall_totals": {
                "total_budget": round(total_budget, 2),
                "total_actual_spend": round(total_actual, 2),
                "total_remaining": round(total_remaining, 2),
                "total_epo_count": total_epos,
                "percent_used": round(total_percent, 2),
                "status": _calculate_budget_status(total_percent),
            },
            "unbudgeted_communities": unbudgeted_communities_list,
        }

    except Exception as e:
        logger.error(f"Error fetching budget overview: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving budget overview")


@router.get("/trends/{community}")
async def get_community_trends(
    community: str,
    months: int = Query(12, ge=1, le=24),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get monthly spend trend for a community.

    Query Parameters:
    - months: Number of months to return (default 12, max 24)

    Returns:
    - Array of {month: "2026-01", budget_portion: float, actual_spend: float, epo_count: int}

    For months with a budget, budget_portion is the monthly allocation (budget / total periods).
    For months without a budget, budget_portion is 0.
    """
    try:
        now = datetime.now(timezone.utc)
        cutoff_date = now - timedelta(days=30 * months)

        # Get budget for this community (if any)
        budget_result = await session.execute(
            select(CommunityBudget).where(
                and_(
                    CommunityBudget.company_id == current_user.company_id,
                    CommunityBudget.community == community,
                    CommunityBudget.is_active == True,
                )
            )
        )
        budget = budget_result.scalars().first()

        # Get EPOs for this community in the period
        epo_result = await session.execute(
            select(EPO).where(
                and_(
                    EPO.company_id == current_user.company_id,
                    EPO.community == community,
                    EPO.status == EPOStatus.CONFIRMED,
                    EPO.created_at >= cutoff_date,
                )
            )
        )
        epos = epo_result.scalars().all()

        # Build monthly trend data
        trend_data = {}
        current_month = cutoff_date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        while current_month <= now:
            month_key = current_month.strftime("%Y-%m")
            trend_data[month_key] = {
                "month": month_key,
                "budget_portion": 0.0,
                "actual_spend": 0.0,
                "epo_count": 0,
            }

            # Calculate budget portion for this month if budget exists
            if budget:
                # Check if this month falls within budget period
                if budget.period_start <= current_month < budget.period_end:
                    # Calculate number of months in budget period
                    start_month = budget.period_start.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
                    end_month = budget.period_end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

                    # Count months (simple approach)
                    months_in_period = (
                        (end_month.year - start_month.year) * 12 + (end_month.month - start_month.month)
                    )
                    if months_in_period == 0:
                        months_in_period = 1

                    trend_data[month_key]["budget_portion"] = budget.budget_amount / months_in_period

            current_month += timedelta(days=32)
            current_month = current_month.replace(day=1)

        # Aggregate EPOs by month
        for epo in epos:
            month_key = epo.created_at.strftime("%Y-%m")
            if month_key in trend_data:
                trend_data[month_key]["actual_spend"] += epo.amount or 0.0
                trend_data[month_key]["epo_count"] += 1

        # Convert to sorted list
        results = []
        for month_key in sorted(trend_data.keys()):
            data = trend_data[month_key]
            results.append({
                "month": data["month"],
                "budget_portion": round(data["budget_portion"], 2),
                "actual_spend": round(data["actual_spend"], 2),
                "epo_count": data["epo_count"],
            })

        return results

    except Exception as e:
        logger.error(f"Error fetching trends for {community}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving trends")
