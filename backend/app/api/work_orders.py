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
    WorkOrder,
    WorkOrderStatus,
    WorkOrderPriority,
    WorkOrderType,
    UserRole,
    CommunityAssignment,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/work-orders", tags=["work-orders"])


# ─── Helper Functions ──────────────────────────────────────────────────────


def _serialize_work_order(order: WorkOrder, assigned_user: Optional[User] = None) -> dict:
    """Convert WorkOrder model to dict for JSON response"""
    return {
        "id": order.id,
        "company_id": order.company_id,
        "created_by_id": order.created_by_id,
        "assigned_to_id": order.assigned_to_id,
        "assigned_to_name": assigned_user.full_name if assigned_user else None,
        "title": order.title,
        "description": order.description,
        "community": order.community,
        "lot_number": order.lot_number,
        "work_type": order.work_type.value,
        "priority": order.priority.value,
        "status": order.status.value,
        "scheduled_date": order.scheduled_date,
        "due_date": order.due_date,
        "started_at": order.started_at,
        "completed_at": order.completed_at,
        "estimated_hours": order.estimated_hours,
        "actual_hours": order.actual_hours,
        "crew_size_needed": order.crew_size_needed,
        "estimated_cost": order.estimated_cost,
        "actual_cost": order.actual_cost,
        "builder_name": order.builder_name,
        "builder_contact": order.builder_contact,
        "epo_id": order.epo_id,
        "completion_notes": order.completion_notes,
        "created_at": order.created_at,
        "updated_at": order.updated_at,
    }


async def _check_work_order_access(
    order_id: int,
    current_user: User,
    session: AsyncSession,
) -> WorkOrder:
    """
    Check if user has access to a work order.
    FIELD users see only orders assigned to them or in their communities.
    ADMIN/MANAGER see all company orders.
    """
    result = await session.execute(select(WorkOrder).where(WorkOrder.id == order_id))
    order = result.scalars().first()

    if not order:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Work order not found")

    # Company check
    if order.company_id != current_user.company_id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    # Admin/Manager can access anything in their company
    if current_user.role in (UserRole.ADMIN, UserRole.MANAGER):
        return order

    # Field users can only see orders assigned to them or in their communities
    if current_user.role == UserRole.FIELD:
        # Check if they're assigned to this order
        if order.assigned_to_id == current_user.id:
            return order

        # Check if they have access to this community (via community assignments)
        result = await session.execute(
            select(CommunityAssignment).where(
                and_(
                    CommunityAssignment.supervisor_id == current_user.id,
                    CommunityAssignment.community_name == order.community,
                )
            )
        )
        if result.scalars().first():
            return order

        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    return order


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/")
async def create_work_order(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Create a new work order.

    Request body:
    - title: str (required)
    - community: str (required)
    - description: str (optional)
    - lot_number: str (optional)
    - work_type: str (optional, default: "other")
    - priority: str (optional, default: "normal")
    - status: str (optional, default: "open")
    - assigned_to_id: int (optional)
    - scheduled_date: ISO datetime (optional)
    - due_date: ISO datetime (optional)
    - estimated_hours: float (optional)
    - crew_size_needed: int (optional)
    - estimated_cost: float (optional)
    - builder_name: str (optional)
    - builder_contact: str (optional)
    - epo_id: int (optional)
    """
    try:
        # Validate required fields
        if not data.get("title") or not data.get("community"):
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="title and community are required",
            )

        # Validate and parse work_type
        work_type = WorkOrderType.OTHER
        if data.get("work_type"):
            try:
                work_type = WorkOrderType(data["work_type"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid work_type. Must be one of: {', '.join([t.value for t in WorkOrderType])}",
                )

        # Validate and parse priority
        priority = WorkOrderPriority.NORMAL
        if data.get("priority"):
            try:
                priority = WorkOrderPriority(data["priority"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in WorkOrderPriority])}",
                )

        # Validate and parse status
        status = WorkOrderStatus.OPEN
        if data.get("status"):
            try:
                status = WorkOrderStatus(data["status"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status. Must be one of: {', '.join([s.value for s in WorkOrderStatus])}",
                )

        # Parse dates if provided
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

        # Create work order
        order = WorkOrder(
            company_id=current_user.company_id,
            created_by_id=current_user.id,
            assigned_to_id=assigned_to_id,
            title=data["title"],
            description=data.get("description"),
            community=data["community"],
            lot_number=data.get("lot_number"),
            work_type=work_type,
            priority=priority,
            status=status,
            scheduled_date=scheduled_date,
            due_date=due_date,
            estimated_hours=data.get("estimated_hours"),
            crew_size_needed=data.get("crew_size_needed"),
            estimated_cost=data.get("estimated_cost"),
            builder_name=data.get("builder_name"),
            builder_contact=data.get("builder_contact"),
            epo_id=data.get("epo_id"),
        )

        session.add(order)
        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} created by user {current_user.id} for company {current_user.company_id}")
        return _serialize_work_order(order)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error creating work order")


@router.get("/")
async def list_work_orders(
    community: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    work_type: Optional[str] = Query(None),
    assigned_to_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    List work orders with optional filters.

    Query Parameters:
    - community: Filter by community name (optional)
    - status: Filter by status (optional)
    - priority: Filter by priority (optional)
    - work_type: Filter by work type (optional)
    - assigned_to_id: Filter by assigned user (optional)
    - page: Page number (default 1)
    - per_page: Results per page (default 20, max 100)

    Returns paginated results sorted by priority (urgent first) then due_date.
    FIELD users see only orders assigned to them or in their communities.
    """
    try:
        # Build base query
        query = select(WorkOrder).where(WorkOrder.company_id == current_user.company_id)

        # Role-based filtering
        if current_user.role == UserRole.FIELD:
            # Field users see orders assigned to them or in their communities
            result = await session.execute(
                select(CommunityAssignment.community_name).where(
                    CommunityAssignment.supervisor_id == current_user.id
                )
            )
            communities = [row[0] for row in result.all()]

            # Orders assigned to user OR in user's communities
            query = query.where(
                or_(
                    WorkOrder.assigned_to_id == current_user.id,
                    WorkOrder.community.in_(communities) if communities else False,
                )
            )

        # Apply filters
        if community:
            query = query.where(WorkOrder.community.ilike(f"%{community}%"))

        if status:
            try:
                status_enum = WorkOrderStatus(status)
                query = query.where(WorkOrder.status == status_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid status. Must be one of: {', '.join([s.value for s in WorkOrderStatus])}",
                )

        if priority:
            try:
                priority_enum = WorkOrderPriority(priority)
                query = query.where(WorkOrder.priority == priority_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in WorkOrderPriority])}",
                )

        if work_type:
            try:
                work_type_enum = WorkOrderType(work_type)
                query = query.where(WorkOrder.work_type == work_type_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid work_type. Must be one of: {', '.join([t.value for t in WorkOrderType])}",
                )

        if assigned_to_id is not None:
            query = query.where(WorkOrder.assigned_to_id == assigned_to_id)

        # Get total count
        count_result = await session.execute(select(func.count()).select_from(WorkOrder).where(query.whereclause))
        total = count_result.scalar()

        # Sort: priority first (urgent first), then by due_date
        priority_order = {
            WorkOrderPriority.URGENT: 0,
            WorkOrderPriority.HIGH: 1,
            WorkOrderPriority.NORMAL: 2,
            WorkOrderPriority.LOW: 3,
        }
        query = query.order_by(WorkOrder.priority).order_by(WorkOrder.due_date.asc())

        # Pagination
        offset = (page - 1) * per_page
        query = query.offset(offset).limit(per_page)

        result = await session.execute(query)
        orders = result.scalars().all()

        # Fetch assigned user info for each order
        assigned_users = {}
        for order in orders:
            if order.assigned_to_id and order.assigned_to_id not in assigned_users:
                result = await session.execute(select(User).where(User.id == order.assigned_to_id))
                assigned_users[order.assigned_to_id] = result.scalars().first()

        return {
            "items": [_serialize_work_order(order, assigned_users.get(order.assigned_to_id)) for order in orders],
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing work orders: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error listing work orders")


@router.get("/{order_id}")
async def get_work_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get a single work order by ID."""
    try:
        order = await _check_work_order_access(order_id, current_user, session)
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting work order")


@router.put("/{order_id}")
async def update_work_order(
    order_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Update a work order. Only ADMIN/MANAGER or the assigned user can update.

    Request body (all optional):
    - title, description, lot_number, community
    - work_type, priority
    - assigned_to_id, scheduled_date, due_date
    - estimated_hours, crew_size_needed, estimated_cost
    - builder_name, builder_contact
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only ADMIN/MANAGER or assigned user can update
        if current_user.role == UserRole.FIELD and order.assigned_to_id != current_user.id:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only assigned user can update")

        # Update simple fields
        if "title" in data:
            order.title = data["title"]
        if "description" in data:
            order.description = data["description"]
        if "lot_number" in data:
            order.lot_number = data["lot_number"]
        if "community" in data:
            order.community = data["community"]
        if "builder_name" in data:
            order.builder_name = data["builder_name"]
        if "builder_contact" in data:
            order.builder_contact = data["builder_contact"]
        if "estimated_hours" in data:
            order.estimated_hours = data["estimated_hours"]
        if "crew_size_needed" in data:
            order.crew_size_needed = data["crew_size_needed"]
        if "estimated_cost" in data:
            order.estimated_cost = data["estimated_cost"]

        # Validate and update work_type
        if "work_type" in data:
            try:
                order.work_type = WorkOrderType(data["work_type"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid work_type. Must be one of: {', '.join([t.value for t in WorkOrderType])}",
                )

        # Validate and update priority
        if "priority" in data:
            try:
                order.priority = WorkOrderPriority(data["priority"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid priority. Must be one of: {', '.join([p.value for p in WorkOrderPriority])}",
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
            order.assigned_to_id = assigned_to_id

        # Parse and update dates
        if "scheduled_date" in data:
            if data["scheduled_date"] is None:
                order.scheduled_date = None
            else:
                try:
                    if isinstance(data["scheduled_date"], str):
                        scheduled_date = datetime.fromisoformat(data["scheduled_date"].replace("Z", "+00:00"))
                    else:
                        scheduled_date = data["scheduled_date"]
                    if scheduled_date.tzinfo is None:
                        scheduled_date = scheduled_date.replace(tzinfo=timezone.utc)
                    order.scheduled_date = scheduled_date
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid scheduled_date format",
                    )

        if "due_date" in data:
            if data["due_date"] is None:
                order.due_date = None
            else:
                try:
                    if isinstance(data["due_date"], str):
                        due_date = datetime.fromisoformat(data["due_date"].replace("Z", "+00:00"))
                    else:
                        due_date = data["due_date"]
                    if due_date.tzinfo is None:
                        due_date = due_date.replace(tzinfo=timezone.utc)
                    order.due_date = due_date
                except Exception:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail="Invalid due_date format",
                    )

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} updated by user {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error updating work order")


@router.post("/{order_id}/assign")
async def assign_work_order(
    order_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Assign a work order to a user and set status to ASSIGNED.

    Request body:
    - assigned_to_id: int (required)
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only ADMIN/MANAGER can assign
        if current_user.role == UserRole.FIELD:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only managers can assign")

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

        order.assigned_to_id = data["assigned_to_id"]
        order.status = WorkOrderStatus.ASSIGNED

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} assigned to user {data['assigned_to_id']} by {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error assigning work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error assigning work order")


@router.post("/{order_id}/start")
async def start_work_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Start work on an order. Sets started_at and status to IN_PROGRESS.
    Only the assigned user or managers can start.
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only assigned user or ADMIN/MANAGER can start
        if current_user.role == UserRole.FIELD and order.assigned_to_id != current_user.id:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only assigned user can start work")

        order.started_at = datetime.now(timezone.utc)
        order.status = WorkOrderStatus.IN_PROGRESS

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} started by user {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error starting work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error starting work order")


@router.post("/{order_id}/complete")
async def complete_work_order(
    order_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Complete a work order. Sets completed_at, actual_hours, completion_notes, and status to COMPLETED.

    Request body:
    - actual_hours: float (optional)
    - completion_notes: str (optional)
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only assigned user or ADMIN/MANAGER can complete
        if current_user.role == UserRole.FIELD and order.assigned_to_id != current_user.id:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only assigned user can complete")

        order.completed_at = datetime.now(timezone.utc)
        order.status = WorkOrderStatus.COMPLETED

        if "actual_hours" in data and data["actual_hours"] is not None:
            order.actual_hours = data["actual_hours"]

        if "completion_notes" in data and data["completion_notes"] is not None:
            order.completion_notes = data["completion_notes"]

        if "actual_cost" in data and data["actual_cost"] is not None:
            order.actual_cost = data["actual_cost"]

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} completed by user {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error completing work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error completing work order")


@router.post("/{order_id}/hold")
async def hold_work_order(
    order_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Put a work order on hold.

    Request body:
    - reason: str (optional) — stored in completion_notes
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only assigned user or ADMIN/MANAGER can put on hold
        if current_user.role == UserRole.FIELD and order.assigned_to_id != current_user.id:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only assigned user can put on hold")

        order.status = WorkOrderStatus.ON_HOLD

        if data.get("reason"):
            order.completion_notes = f"On hold: {data['reason']}"

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} put on hold by user {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error putting work order on hold: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error putting work order on hold")


@router.post("/{order_id}/cancel")
async def cancel_work_order(
    order_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Cancel a work order. Only ADMIN/MANAGER can cancel.

    Request body:
    - reason: str (optional) — stored in completion_notes
    """
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only ADMIN/MANAGER can cancel
        if current_user.role != UserRole.ADMIN and current_user.role != UserRole.MANAGER:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only managers can cancel")

        order.status = WorkOrderStatus.CANCELLED

        if data.get("reason"):
            order.completion_notes = f"Cancelled: {data['reason']}"

        await session.commit()
        await session.refresh(order)

        logger.info(f"Work order {order.id} cancelled by user {current_user.id}")
        assigned_user = order.assigned_to if order.assigned_to_id else None
        return _serialize_work_order(order, assigned_user)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error cancelling work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error cancelling work order")


@router.delete("/{order_id}")
async def delete_work_order(
    order_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Delete a work order. Only ADMIN can delete."""
    try:
        order = await _check_work_order_access(order_id, current_user, session)

        # Only ADMIN can delete
        if current_user.role != UserRole.ADMIN:
            raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only admins can delete")

        await session.delete(order)
        await session.commit()

        logger.info(f"Work order {order.id} deleted by user {current_user.id}")
        return {"message": "Work order deleted"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting work order: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error deleting work order")


@router.get("/summary/stats")
async def get_work_order_stats(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get work order summary statistics.

    Returns:
    - counts_by_status: dict of status -> count
    - overdue_count: number of orders past due_date and not completed
    - this_week_count: orders scheduled this week
    - by_community: dict of community -> count
    - by_work_type: dict of work_type -> count
    - hours_summary: estimated vs actual hours
    - cost_summary: estimated vs actual cost
    """
    try:
        # Get all orders in company (respecting role-based access)
        query = select(WorkOrder).where(WorkOrder.company_id == current_user.company_id)

        if current_user.role == UserRole.FIELD:
            result = await session.execute(
                select(CommunityAssignment.community_name).where(
                    CommunityAssignment.supervisor_id == current_user.id
                )
            )
            communities = [row[0] for row in result.all()]
            query = query.where(
                or_(
                    WorkOrder.assigned_to_id == current_user.id,
                    WorkOrder.community.in_(communities) if communities else False,
                )
            )

        result = await session.execute(query)
        orders = result.scalars().all()

        # Count by status
        counts_by_status = {}
        for status in WorkOrderStatus:
            count = len([o for o in orders if o.status == status])
            counts_by_status[status.value] = count

        # Count overdue (due_date in past and not completed)
        now = datetime.now(timezone.utc)
        overdue_count = len(
            [o for o in orders if o.due_date and o.due_date < now and o.status != WorkOrderStatus.COMPLETED]
        )

        # This week's workload
        week_start = now - timedelta(days=now.weekday())
        week_start = week_start.replace(hour=0, minute=0, second=0, microsecond=0)
        week_end = week_start + timedelta(days=7)
        this_week_count = len(
            [o for o in orders if o.scheduled_date and week_start <= o.scheduled_date < week_end]
        )

        # By community
        by_community = {}
        for order in orders:
            community = order.community
            by_community[community] = by_community.get(community, 0) + 1

        # By work_type
        by_work_type = {}
        for work_type in WorkOrderType:
            count = len([o for o in orders if o.work_type == work_type])
            if count > 0:
                by_work_type[work_type.value] = count

        # Hours summary
        total_estimated_hours = sum([o.estimated_hours for o in orders if o.estimated_hours])
        total_actual_hours = sum([o.actual_hours for o in orders if o.actual_hours])
        hours_summary = {
            "estimated_total": total_estimated_hours,
            "actual_total": total_actual_hours,
            "completed_count": len([o for o in orders if o.status == WorkOrderStatus.COMPLETED]),
        }

        # Cost summary
        total_estimated_cost = sum([o.estimated_cost for o in orders if o.estimated_cost])
        total_actual_cost = sum([o.actual_cost for o in orders if o.actual_cost])
        cost_summary = {
            "estimated_total": total_estimated_cost,
            "actual_total": total_actual_cost,
            "completed_count": len([o for o in orders if o.status == WorkOrderStatus.COMPLETED]),
        }

        return {
            "counts_by_status": counts_by_status,
            "overdue_count": overdue_count,
            "this_week_count": this_week_count,
            "by_community": by_community,
            "by_work_type": by_work_type,
            "hours_summary": hours_summary,
            "cost_summary": cost_summary,
        }

    except Exception as e:
        logger.error(f"Error getting work order stats: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting work order stats")


@router.get("/schedule/week")
async def get_week_schedule(
    week_start: Optional[str] = Query(None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get weekly schedule view.

    Query Parameters:
    - week_start: ISO date string (optional, defaults to current week start)

    Returns work orders grouped by day of the week with assigned person name.
    """
    try:
        # Parse week_start or use current week
        if week_start:
            try:
                start_date = datetime.fromisoformat(week_start.replace("Z", "+00:00"))
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid week_start format",
                )
        else:
            start_date = datetime.now(timezone.utc)

        # Normalize to start of week (Monday)
        start_date = start_date - timedelta(days=start_date.weekday())
        start_date = start_date.replace(hour=0, minute=0, second=0, microsecond=0)
        end_date = start_date + timedelta(days=7)

        # Get all orders in company for this week (respecting role-based access)
        query = select(WorkOrder).where(
            and_(
                WorkOrder.company_id == current_user.company_id,
                WorkOrder.scheduled_date >= start_date,
                WorkOrder.scheduled_date < end_date,
            )
        )

        if current_user.role == UserRole.FIELD:
            result = await session.execute(
                select(CommunityAssignment.community_name).where(
                    CommunityAssignment.supervisor_id == current_user.id
                )
            )
            communities = [row[0] for row in result.all()]
            query = query.where(
                or_(
                    WorkOrder.assigned_to_id == current_user.id,
                    WorkOrder.community.in_(communities) if communities else False,
                )
            )

        result = await session.execute(query)
        orders = result.scalars().all()

        # Group by day of week
        days_of_week = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        schedule = {day: [] for day in days_of_week}

        for order in orders:
            if order.scheduled_date:
                day_index = order.scheduled_date.weekday()
                day_name = days_of_week[day_index]
                assigned_user = order.assigned_to if order.assigned_to_id else None
                schedule[day_name].append(_serialize_work_order(order, assigned_user))

        return {
            "week_start": start_date.isoformat(),
            "week_end": end_date.isoformat(),
            "schedule": schedule,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting week schedule: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error getting week schedule")
