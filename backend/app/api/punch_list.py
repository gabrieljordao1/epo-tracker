from fastapi import APIRouter, Depends, Query, HTTPException, status as http_status
from sqlalchemy import select, func, and_, or_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import logging

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import (
    User,
    PunchItem,
    PunchStatus,
    PunchPriority,
    PunchCategory,
    UserRole,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/punch-list", tags=["punch-list"])


# ─── Helper Functions ──────────────────────────────────────────────────────


def _serialize_punch_item(item: PunchItem) -> dict:
    """Convert PunchItem model to dict for JSON response"""
    return {
        "id": item.id,
        "company_id": item.company_id,
        "created_by_id": item.created_by_id,
        "assigned_to_id": item.assigned_to_id,
        "community": item.community,
        "lot_number": item.lot_number,
        "location": item.location,
        "title": item.title,
        "description": item.description,
        "category": item.category.value,
        "priority": item.priority.value,
        "status": item.status.value,
        "reported_by": item.reported_by,
        "builder_name": item.builder_name,
        "resolution_notes": item.resolution_notes,
        "completed_by_id": item.completed_by_id,
        "completed_at": item.completed_at,
        "verified_by_id": item.verified_by_id,
        "verified_at": item.verified_at,
        "due_date": item.due_date,
        "scheduled_date": item.scheduled_date,
        "photo_url": item.photo_url,
        "completion_photo_url": item.completion_photo_url,
        "created_at": item.created_at,
        "updated_at": item.updated_at,
    }


async def _check_punch_access(
    item_id: int,
    current_user: User,
    session: AsyncSession,
) -> PunchItem:
    """
    Check if user has access to a punch item.
    FIELD users see only items in their communities or assigned to them.
    ADMIN/MANAGER see all company items.
    """
    result = await session.execute(
        select(PunchItem).where(
            and_(PunchItem.id == item_id, PunchItem.company_id == current_user.company_id)
        )
    )
    item = result.scalars().first()

    if not item:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Punch item not found")

    # Admin/Manager can access anything in their company
    if current_user.role in (UserRole.ADMIN, UserRole.MANAGER):
        return item

    # Field users can only see items in their communities or assigned to them
    if current_user.role == UserRole.FIELD:
        # Check if they're assigned to this item
        if item.assigned_to_id == current_user.id:
            return item

        # Check if they have access to this community (via community assignments)
        from ..models.models import CommunityAssignment

        result = await session.execute(
            select(CommunityAssignment).where(
                and_(
                    CommunityAssignment.supervisor_id == current_user.id,
                    CommunityAssignment.community_name == item.community,
                )
            )
        )
        if result.scalars().first():
            return item

        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    return item


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/")
async def create_punch_item(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Create a new punch item.

    Request body:
    - community: str (required)
    - lot_number: str (required)
    - title: str (required)
    - location: str (optional, e.g., "Master Bedroom")
    - description: str (optional)
    - category: str (optional, default: "other")
    - priority: str (optional, default: "medium")
    - status: str (optional, default: "open")
    - reported_by: str (optional)
    - builder_name: str (optional)
    - assigned_to_id: int (optional)
    - due_date: ISO datetime (optional)
    - scheduled_date: ISO datetime (optional)
    - photo_url: str (optional)
    """
    try:
        # Validate required fields
        if not data.get("community") or not data.get("lot_number") or not data.get("title"):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="community, lot_number, and title are required",
            )

        # Validate and parse category
        category = PunchCategory.OTHER
        if data.get("category"):
            try:
                category = PunchCategory(data["category"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid category. Must be one of: {', '.join([c.value for c in PunchCategory])}",
                )

        # Validate and parse priority
        priority = PunchPriority.MEDIUM
        if data.get("priority"):
            try:
                priority = PunchPriority(data["priority"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in PunchPriority])}",
                )

        # Validate and parse status
        status = PunchStatus.OPEN
        if data.get("status"):
            try:
                status = PunchStatus(data["status"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status. Must be one of: {', '.join([s.value for s in PunchStatus])}",
                )

        # Parse dates if provided
        due_date = None
        if data.get("due_date"):
            try:
                if isinstance(data["due_date"], str):
                    due_date = datetime.fromisoformat(data["due_date"].replace("Z", "+00:00"))
                else:
                    due_date = data["due_date"]
                if due_date.tzinfo is None:
                    due_date = due_date.replace(tzinfo=timezone.utc)
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid due_date format",
                )

        scheduled_date = None
        if data.get("scheduled_date"):
            try:
                if isinstance(data["scheduled_date"], str):
                    scheduled_date = datetime.fromisoformat(data["scheduled_date"].replace("Z", "+00:00"))
                else:
                    scheduled_date = data["scheduled_date"]
                if scheduled_date.tzinfo is None:
                    scheduled_date = scheduled_date.replace(tzinfo=timezone.utc)
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid scheduled_date format",
                )

        # Verify assigned_to user exists and is in same company if provided
        assigned_to_id = data.get("assigned_to_id")
        if assigned_to_id:
            result = await session.execute(
                select(User).where(
                    and_(User.id == assigned_to_id, User.company_id == current_user.company_id)
                )
            )
            if not result.scalars().first():
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="assigned_to_id user not found or not in same company",
                )

        # Create punch item
        item = PunchItem(
            company_id=current_user.company_id,
            created_by_id=current_user.id,
            assigned_to_id=assigned_to_id,
            community=data["community"],
            lot_number=data["lot_number"],
            location=data.get("location"),
            title=data["title"],
            description=data.get("description"),
            category=category,
            priority=priority,
            status=status,
            reported_by=data.get("reported_by"),
            builder_name=data.get("builder_name"),
            due_date=due_date,
            scheduled_date=scheduled_date,
            photo_url=data.get("photo_url"),
        )

        session.add(item)
        await session.commit()
        await session.refresh(item)

        logger.info(f"Punch item {item.id} created by user {current_user.id} for company {current_user.company_id}")
        return _serialize_punch_item(item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error creating punch item")


@router.get("/")
async def list_punch_items(
    community: Optional[str] = Query(None),
    lot_number: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    assigned_to_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    List punch items with optional filters.

    Query Parameters:
    - community: Filter by community name (optional)
    - lot_number: Filter by lot number (optional)
    - status: Filter by status (optional)
    - priority: Filter by priority (optional)
    - category: Filter by category (optional)
    - assigned_to_id: Filter by assigned user (optional)
    - page: Page number (default 1)
    - per_page: Results per page (default 20, max 100)

    Returns paginated results sorted by priority (critical first) then created_at desc.
    """
    try:
        # Build base query
        query = select(PunchItem).where(PunchItem.company_id == current_user.company_id)

        # Role-based filtering
        if current_user.role == UserRole.FIELD:
            # Field users see items assigned to them or in their communities
            from ..models.models import CommunityAssignment

            # Get user's assigned communities
            result = await session.execute(
                select(CommunityAssignment.community_name).where(
                    CommunityAssignment.supervisor_id == current_user.id
                )
            )
            communities = [row[0] for row in result.all()]

            # Items assigned to user OR in user's communities
            query = query.where(
                or_(
                    PunchItem.assigned_to_id == current_user.id,
                    PunchItem.community.in_(communities) if communities else False,
                )
            )

        # Apply filters
        if community:
            query = query.where(PunchItem.community.ilike(f"%{community}%"))

        if lot_number:
            query = query.where(PunchItem.lot_number.ilike(f"%{lot_number}%"))

        if status:
            try:
                status_enum = PunchStatus(status)
                query = query.where(PunchItem.status == status_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status. Must be one of: {', '.join([s.value for s in PunchStatus])}",
                )

        if priority:
            try:
                priority_enum = PunchPriority(priority)
                query = query.where(PunchItem.priority == priority_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in PunchPriority])}",
                )

        if category:
            try:
                category_enum = PunchCategory(category)
                query = query.where(PunchItem.category == category_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid category. Must be one of: {', '.join([c.value for c in PunchCategory])}",
                )

        if assigned_to_id is not None:
            query = query.where(PunchItem.assigned_to_id == assigned_to_id)

        # Get total count
        count_result = await session.execute(select(func.count()).select_from(PunchItem).where(query.whereclause))
        total = count_result.scalar()

        # Sort: critical priority first, then by created_at desc
        priority_order = {
            PunchPriority.CRITICAL: 0,
            PunchPriority.HIGH: 1,
            PunchPriority.MEDIUM: 2,
            PunchPriority.LOW: 3,
        }
        query = query.order_by(PunchItem.priority).order_by(desc(PunchItem.created_at))

        # Pagination
        offset = (page - 1) * per_page
        query = query.offset(offset).limit(per_page)

        result = await session.execute(query)
        items = result.scalars().all()

        # Sort in Python for priority ordering
        items = sorted(items, key=lambda x: (priority_order.get(x.priority, 999), -x.created_at.timestamp()))

        return {
            "items": [_serialize_punch_item(item) for item in items],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing punch items: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error listing punch items")


@router.get("/{item_id}")
async def get_punch_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get a single punch item by ID."""
    try:
        item = await _check_punch_access(item_id, current_user, session)
        return _serialize_punch_item(item)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting punch item")


@router.put("/{item_id}")
async def update_punch_item(
    item_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Update a punch item.

    Can update any field: community, lot_number, location, title, description,
    category, priority, status, reported_by, builder_name, assigned_to_id,
    due_date, scheduled_date, photo_url, etc.
    """
    try:
        item = await _check_punch_access(item_id, current_user, session)

        # Update simple string fields
        if "community" in data:
            item.community = data["community"]
        if "lot_number" in data:
            item.lot_number = data["lot_number"]
        if "location" in data:
            item.location = data["location"]
        if "title" in data:
            item.title = data["title"]
        if "description" in data:
            item.description = data["description"]
        if "reported_by" in data:
            item.reported_by = data["reported_by"]
        if "builder_name" in data:
            item.builder_name = data["builder_name"]

        # Update enum fields with validation
        if "category" in data:
            try:
                item.category = PunchCategory(data["category"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid category. Must be one of: {', '.join([c.value for c in PunchCategory])}",
                )

        if "priority" in data:
            try:
                item.priority = PunchPriority(data["priority"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in PunchPriority])}",
                )

        if "status" in data:
            try:
                item.status = PunchStatus(data["status"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status. Must be one of: {', '.join([s.value for s in PunchStatus])}",
                )

        # Update assigned_to_id
        if "assigned_to_id" in data:
            assigned_to_id = data["assigned_to_id"]
            if assigned_to_id is not None:
                result = await session.execute(
                    select(User).where(
                        and_(User.id == assigned_to_id, User.company_id == current_user.company_id)
                    )
                )
                if not result.scalars().first():
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="assigned_to_id user not found or not in same company",
                    )
            item.assigned_to_id = assigned_to_id

        # Update date fields
        if "due_date" in data:
            if data["due_date"] is None:
                item.due_date = None
            else:
                try:
                    due_date = data["due_date"]
                    if isinstance(due_date, str):
                        due_date = datetime.fromisoformat(due_date.replace("Z", "+00:00"))
                    if due_date.tzinfo is None:
                        due_date = due_date.replace(tzinfo=timezone.utc)
                    item.due_date = due_date
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid due_date format",
                    )

        if "scheduled_date" in data:
            if data["scheduled_date"] is None:
                item.scheduled_date = None
            else:
                try:
                    scheduled_date = data["scheduled_date"]
                    if isinstance(scheduled_date, str):
                        scheduled_date = datetime.fromisoformat(scheduled_date.replace("Z", "+00:00"))
                    if scheduled_date.tzinfo is None:
                        scheduled_date = scheduled_date.replace(tzinfo=timezone.utc)
                    item.scheduled_date = scheduled_date
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid scheduled_date format",
                    )

        # Update photo URLs
        if "photo_url" in data:
            item.photo_url = data["photo_url"]
        if "completion_photo_url" in data:
            item.completion_photo_url = data["completion_photo_url"]

        await session.commit()
        await session.refresh(item)

        logger.info(f"Punch item {item.id} updated by user {current_user.id}")
        return _serialize_punch_item(item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error updating punch item")


@router.post("/{item_id}/assign")
async def assign_punch_item(
    item_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Assign a punch item to a team member.

    Request body:
    - assigned_to_id: int (required)

    If item is currently OPEN, status is automatically set to IN_PROGRESS.
    """
    try:
        item = await _check_punch_access(item_id, current_user, session)

        if not data.get("assigned_to_id"):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="assigned_to_id is required",
            )

        # Verify user exists and is in same company
        result = await session.execute(
            select(User).where(
                and_(User.id == data["assigned_to_id"], User.company_id == current_user.company_id)
            )
        )
        if not result.scalars().first():
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="User not found or not in same company",
            )

        item.assigned_to_id = data["assigned_to_id"]

        # Auto-transition OPEN items to IN_PROGRESS
        if item.status == PunchStatus.OPEN:
            item.status = PunchStatus.IN_PROGRESS

        await session.commit()
        await session.refresh(item)

        logger.info(f"Punch item {item_id} assigned to user {data['assigned_to_id']} by {current_user.id}")
        return _serialize_punch_item(item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error assigning punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error assigning punch item")


@router.post("/{item_id}/complete")
async def complete_punch_item(
    item_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Mark a punch item as completed.

    Request body:
    - resolution_notes: str (optional)
    - completion_photo_url: str (optional)

    Sets completed_by_id, completed_at, and status to COMPLETED.
    """
    try:
        item = await _check_punch_access(item_id, current_user, session)

        if "resolution_notes" in data:
            item.resolution_notes = data["resolution_notes"]

        if "completion_photo_url" in data:
            item.completion_photo_url = data["completion_photo_url"]

        item.completed_by_id = current_user.id
        item.completed_at = datetime.now(timezone.utc)
        item.status = PunchStatus.COMPLETED

        await session.commit()
        await session.refresh(item)

        logger.info(f"Punch item {item_id} marked completed by user {current_user.id}")
        return _serialize_punch_item(item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error completing punch item")


@router.post("/{item_id}/verify")
async def verify_punch_item(
    item_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Verify/inspect and approve or reject a punch item fix.

    Request body:
    - approved: bool (required)
    - notes: str (optional)

    If approved=true: status = VERIFIED, verified_by_id and verified_at are set
    If approved=false: status = REJECTED, item needs rework
    """
    try:
        item = await _check_punch_access(item_id, current_user, session)

        if "approved" not in data or data["approved"] is None:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="approved (bool) is required",
            )

        approved = data["approved"]
        if not isinstance(approved, bool):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="approved must be a boolean",
            )

        if "notes" in data:
            item.resolution_notes = data["notes"]

        if approved:
            item.status = PunchStatus.VERIFIED
            item.verified_by_id = current_user.id
            item.verified_at = datetime.now(timezone.utc)
            logger.info(f"Punch item {item_id} verified by user {current_user.id}")
        else:
            item.status = PunchStatus.REJECTED
            logger.info(f"Punch item {item_id} rejected by user {current_user.id}")

        await session.commit()
        await session.refresh(item)

        return _serialize_punch_item(item)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error verifying punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error verifying punch item")


@router.delete("/{item_id}")
async def delete_punch_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Delete a punch item (admin only)."""
    try:
        # Admin-only check
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Admin access required")

        item = await _check_punch_access(item_id, current_user, session)

        await session.delete(item)
        await session.commit()

        logger.info(f"Punch item {item_id} deleted by admin user {current_user.id}")
        return {"message": "Punch item deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting punch item: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error deleting punch item")


@router.get("/summary/stats")
async def get_punch_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get punch list summary statistics.

    Returns:
    - total_open: Count of OPEN items
    - total_in_progress: Count of IN_PROGRESS items
    - total_completed: Count of COMPLETED items
    - total_verified: Count of VERIFIED items
    - total_rejected: Count of REJECTED items
    - overdue_count: Count of items past due_date and not yet VERIFIED
    - by_community: Breakdown by community
    - by_category: Breakdown by category
    - by_priority: Breakdown by priority
    - average_resolution_time_days: Average days from created to completed
    """
    try:
        # Base query for user's company
        query = select(PunchItem).where(PunchItem.company_id == current_user.company_id)

        # Role-based filtering
        if current_user.role == UserRole.FIELD:
            from ..models.models import CommunityAssignment

            result = await session.execute(
                select(CommunityAssignment.community_name).where(
                    CommunityAssignment.supervisor_id == current_user.id
                )
            )
            communities = [row[0] for row in result.all()]

            query = query.where(
                or_(
                    PunchItem.assigned_to_id == current_user.id,
                    PunchItem.community.in_(communities) if communities else False,
                )
            )

        result = await session.execute(query)
        items = result.scalars().all()

        now = datetime.now(timezone.utc)

        # Count by status
        status_counts = {}
        for status_enum in PunchStatus:
            status_counts[status_enum.value] = sum(1 for item in items if item.status == status_enum)

        # Overdue count: past due_date and not yet VERIFIED/COMPLETED
        overdue_count = sum(
            1 for item in items
            if item.due_date and item.due_date < now and item.status not in (PunchStatus.VERIFIED, PunchStatus.COMPLETED)
        )

        # By community
        by_community = {}
        for item in items:
            if item.community not in by_community:
                by_community[item.community] = 0
            by_community[item.community] += 1

        # By category
        by_category = {}
        for item in items:
            cat_value = item.category.value
            if cat_value not in by_category:
                by_category[cat_value] = 0
            by_category[cat_value] += 1

        # By priority
        by_priority = {}
        for item in items:
            pri_value = item.priority.value
            if pri_value not in by_priority:
                by_priority[pri_value] = 0
            by_priority[pri_value] += 1

        # Average resolution time (days from created to completed)
        completed_items = [item for item in items if item.completed_at]
        avg_resolution_time = None
        if completed_items:
            total_days = sum(
                (item.completed_at - item.created_at).total_seconds() / 86400
                for item in completed_items
            )
            avg_resolution_time = round(total_days / len(completed_items), 2)

        return {
            "total_open": status_counts.get("open", 0),
            "total_in_progress": status_counts.get("in_progress", 0),
            "total_completed": status_counts.get("completed", 0),
            "total_verified": status_counts.get("verified", 0),
            "total_rejected": status_counts.get("rejected", 0),
            "overdue_count": overdue_count,
            "by_community": by_community,
            "by_category": by_category,
            "by_priority": by_priority,
            "average_resolution_time_days": avg_resolution_time,
        }

    except Exception as e:
        logger.error(f"Error getting punch summary: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting punch summary")


@router.get("/lot/{community}/{lot_number}")
async def get_lot_punch_items(
    community: str,
    lot_number: str,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get all punch items for a specific lot, grouped by status.

    Useful for lot closeout checklist. Returns items grouped by status.
    """
    try:
        # Build query
        query = select(PunchItem).where(
            and_(
                PunchItem.company_id == current_user.company_id,
                PunchItem.community == community,
                PunchItem.lot_number == lot_number,
            )
        )

        # Role-based access check
        if current_user.role == UserRole.FIELD:
            from ..models.models import CommunityAssignment

            # Check if user has access to this community
            result = await session.execute(
                select(CommunityAssignment).where(
                    and_(
                        CommunityAssignment.supervisor_id == current_user.id,
                        CommunityAssignment.community_name == community,
                    )
                )
            )
            if not result.scalars().first() and not any(
                item.assigned_to_id == current_user.id
                for item in (await session.execute(query)).scalars().all()
            ):
                raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

        result = await session.execute(query)
        items = result.scalars().all()

        # Group by status
        grouped = {}
        for status_enum in PunchStatus:
            grouped[status_enum.value] = [
                _serialize_punch_item(item) for item in items if item.status == status_enum
            ]

        return {
            "community": community,
            "lot_number": lot_number,
            "by_status": grouped,
            "total_items": len(items),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting lot punch items: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting lot punch items")
