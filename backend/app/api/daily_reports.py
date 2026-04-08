from fastapi import APIRouter, Depends, Query, HTTPException, status as http_status
from sqlalchemy import select, func, and_, desc
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Optional
from datetime import datetime, timedelta, timezone
import logging

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, DailyReport, ReportStatus, WeatherCondition, UserRole

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/daily-reports", tags=["daily-reports"])


# ─── Response Models ───────────────────────────────────────────────────────


class DailyReportResponse:
    """Daily report response model"""
    id: int
    company_id: int
    created_by_id: int
    report_date: datetime
    community: str
    lot_number: Optional[str]
    work_performed: Optional[str]
    phase: Optional[str]
    units_completed: Optional[int]
    percent_complete: Optional[float]
    crew_size: Optional[int]
    crew_hours: Optional[float]
    weather: Optional[str]
    temperature_high: Optional[int]
    work_delayed: bool
    delay_reason: Optional[str]
    issues_noted: Optional[str]
    safety_incidents: bool
    safety_notes: Optional[str]
    materials_needed: Optional[str]
    materials_delivered: Optional[str]
    inspections_passed: Optional[int]
    inspections_failed: Optional[int]
    rework_needed: Optional[str]
    status: str
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime


class PaginatedReportsResponse:
    """Paginated daily reports response"""
    items: List[dict]
    total: int
    page: int
    per_page: int
    total_pages: int


class ReportSummaryStats:
    """Summary statistics for reports dashboard"""
    total_reports_this_week: int
    total_reports_this_month: int
    active_communities_count: int
    total_crew_hours_this_week: float
    safety_incidents_count: int
    average_crew_size: Optional[float]
    reports_by_community: dict


# ─── Helper Functions ──────────────────────────────────────────────────────


def _serialize_report(report: DailyReport) -> dict:
    """Convert DailyReport model to dict for JSON response"""
    return {
        "id": report.id,
        "company_id": report.company_id,
        "created_by_id": report.created_by_id,
        "report_date": report.report_date,
        "community": report.community,
        "lot_number": report.lot_number,
        "work_performed": report.work_performed,
        "phase": report.phase,
        "units_completed": report.units_completed,
        "percent_complete": report.percent_complete,
        "crew_size": report.crew_size,
        "crew_hours": report.crew_hours,
        "weather": report.weather.value if report.weather else None,
        "temperature_high": report.temperature_high,
        "work_delayed": report.work_delayed,
        "delay_reason": report.delay_reason,
        "issues_noted": report.issues_noted,
        "safety_incidents": report.safety_incidents,
        "safety_notes": report.safety_notes,
        "materials_needed": report.materials_needed,
        "materials_delivered": report.materials_delivered,
        "inspections_passed": report.inspections_passed,
        "inspections_failed": report.inspections_failed,
        "rework_needed": report.rework_needed,
        "status": report.status.value,
        "notes": report.notes,
        "created_at": report.created_at,
        "updated_at": report.updated_at,
    }


async def _check_report_access(
    report_id: int,
    current_user: User,
    session: AsyncSession,
    require_creator: bool = False,
) -> DailyReport:
    """
    Check if user has access to a report.

    If require_creator=True, only the creator or ADMIN can access.
    Otherwise, FIELD users see only their reports, ADMIN/MANAGER see all company reports.
    """
    result = await session.execute(
        select(DailyReport).where(DailyReport.id == report_id)
    )
    report = result.scalars().first()

    if not report:
        raise HTTPException(status_code=http_status.HTTP_404_NOT_FOUND, detail="Report not found")

    # Admin can always access
    if current_user.role == UserRole.ADMIN:
        return report

    # Company check
    if report.company_id != current_user.company_id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    # Creator-only check (for update/delete operations)
    if require_creator and report.created_by_id != current_user.id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Only creator can modify this report")

    # Field users can only see their own reports
    if current_user.role == UserRole.FIELD and report.created_by_id != current_user.id:
        raise HTTPException(status_code=http_status.HTTP_403_FORBIDDEN, detail="Unauthorized")

    return report


# ─── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/")
async def create_daily_report(
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Create a new daily report.

    Request body:
    - report_date: ISO datetime (required)
    - community: str (required)
    - lot_number: str (optional)
    - work_performed: str (optional)
    - phase: str (optional)
    - units_completed: int (optional)
    - percent_complete: float (optional, 0-100)
    - crew_size: int (optional)
    - crew_hours: float (optional)
    - weather: str (optional, one of: sunny, cloudy, rainy, stormy, snowy, windy, hot, cold)
    - temperature_high: int (optional)
    - work_delayed: bool (optional, default: false)
    - delay_reason: str (optional)
    - issues_noted: str (optional)
    - safety_incidents: bool (optional, default: false)
    - safety_notes: str (optional)
    - materials_needed: str (optional)
    - materials_delivered: str (optional)
    - inspections_passed: int (optional)
    - inspections_failed: int (optional)
    - rework_needed: str (optional)
    - status: str (optional, default: "draft", one of: draft, submitted)
    - notes: str (optional)
    """
    try:
        # Validate required fields
        if "report_date" not in data or "community" not in data:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="report_date and community are required",
            )

        # Parse report_date
        try:
            if isinstance(data["report_date"], str):
                report_date = datetime.fromisoformat(data["report_date"].replace("Z", "+00:00"))
            else:
                report_date = data["report_date"]

            # Ensure timezone-aware
            if report_date.tzinfo is None:
                report_date = report_date.replace(tzinfo=timezone.utc)
        except Exception:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Invalid report_date format",
            )

        # Validate weather enum if provided
        weather = None
        if "weather" in data and data["weather"]:
            try:
                weather = WeatherCondition(data["weather"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail=f"Invalid weather value. Must be one of: {', '.join([w.value for w in WeatherCondition])}",
                )

        # Validate status enum if provided
        status = ReportStatus.DRAFT
        if "status" in data and data["status"]:
            try:
                status = ReportStatus(data["status"])
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Must be one of: draft, submitted",
                )

        # Validate percent_complete range
        if "percent_complete" in data and data["percent_complete"] is not None:
            if not (0 <= data["percent_complete"] <= 100):
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="percent_complete must be between 0 and 100",
                )

        # Create report
        report = DailyReport(
            company_id=current_user.company_id,
            created_by_id=current_user.id,
            report_date=report_date,
            community=data["community"],
            lot_number=data.get("lot_number"),
            work_performed=data.get("work_performed"),
            phase=data.get("phase"),
            units_completed=data.get("units_completed"),
            percent_complete=data.get("percent_complete"),
            crew_size=data.get("crew_size"),
            crew_hours=data.get("crew_hours"),
            weather=weather,
            temperature_high=data.get("temperature_high"),
            work_delayed=data.get("work_delayed", False),
            delay_reason=data.get("delay_reason"),
            issues_noted=data.get("issues_noted"),
            safety_incidents=data.get("safety_incidents", False),
            safety_notes=data.get("safety_notes"),
            materials_needed=data.get("materials_needed"),
            materials_delivered=data.get("materials_delivered"),
            inspections_passed=data.get("inspections_passed"),
            inspections_failed=data.get("inspections_failed"),
            rework_needed=data.get("rework_needed"),
            status=status,
            notes=data.get("notes"),
        )

        session.add(report)
        await session.commit()
        await session.refresh(report)

        logger.info(f"Report {report.id} created by user {current_user.id} for company {current_user.company_id}")
        return _serialize_report(report)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating daily report: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error creating report")


@router.get("/")
async def list_daily_reports(
    community: Optional[str] = Query(None),
    date_from: Optional[str] = Query(None),
    date_to: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    List daily reports with optional filters.

    Query Parameters:
    - community: Filter by community name (optional)
    - date_from: ISO datetime start date (optional)
    - date_to: ISO datetime end date (optional)
    - status: Filter by status - draft or submitted (optional)
    - page: Page number (default 1)
    - per_page: Results per page (default 20, max 100)

    Returns paginated results sorted by report_date descending.
    """
    try:
        # Build base query
        query = select(DailyReport).where(DailyReport.company_id == current_user.company_id)

        # Role-based filtering
        if current_user.role == UserRole.FIELD:
            query = query.where(DailyReport.created_by_id == current_user.id)

        # Apply filters
        if community:
            query = query.where(DailyReport.community.ilike(f"%{community}%"))

        if date_from:
            try:
                from_date = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
                if from_date.tzinfo is None:
                    from_date = from_date.replace(tzinfo=timezone.utc)
                query = query.where(DailyReport.report_date >= from_date)
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date_from format",
                )

        if date_to:
            try:
                to_date = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
                if to_date.tzinfo is None:
                    to_date = to_date.replace(tzinfo=timezone.utc)
                query = query.where(DailyReport.report_date <= to_date)
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid date_to format",
                )

        if status:
            try:
                status_enum = ReportStatus(status)
                query = query.where(DailyReport.status == status_enum)
            except ValueError:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid status. Must be one of: draft, submitted",
                )

        # Get total count before pagination
        count_result = await session.execute(select(func.count(DailyReport.id)).select_from(DailyReport).where(query.whereclause))
        total = count_result.scalar() or 0

        # Apply sorting and pagination
        query = query.order_by(desc(DailyReport.report_date))
        offset = (page - 1) * per_page
        query = query.offset(offset).limit(per_page)

        result = await session.execute(query)
        reports = result.scalars().all()

        # Serialize reports
        items = [_serialize_report(report) for report in reports]

        total_pages = (total + per_page - 1) // per_page

        return {
            "items": items,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": total_pages,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing daily reports: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving reports")


@router.get("/{report_id}")
async def get_daily_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get a single daily report by ID.

    Role-based access:
    - FIELD users see only their own reports
    - ADMIN/MANAGER see all company reports
    """
    try:
        report = await _check_report_access(report_id, current_user, session)
        return _serialize_report(report)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving daily report {report_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving report")


@router.put("/{report_id}")
async def update_daily_report(
    report_id: int,
    data: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Update a daily report.

    Only creator or admin can update.
    Only draft reports can be edited (submitted reports are locked).
    """
    try:
        report = await _check_report_access(report_id, current_user, session, require_creator=True)

        # Check if report is locked
        if report.status == ReportStatus.SUBMITTED:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Cannot update submitted reports",
            )

        # Update fields
        if "report_date" in data:
            try:
                if isinstance(data["report_date"], str):
                    report_date = datetime.fromisoformat(data["report_date"].replace("Z", "+00:00"))
                else:
                    report_date = data["report_date"]
                if report_date.tzinfo is None:
                    report_date = report_date.replace(tzinfo=timezone.utc)
                report.report_date = report_date
            except Exception:
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="Invalid report_date format",
                )

        if "community" in data:
            report.community = data["community"]

        if "lot_number" in data:
            report.lot_number = data["lot_number"]

        if "work_performed" in data:
            report.work_performed = data["work_performed"]

        if "phase" in data:
            report.phase = data["phase"]

        if "units_completed" in data:
            report.units_completed = data["units_completed"]

        if "percent_complete" in data:
            if data["percent_complete"] is not None and not (0 <= data["percent_complete"] <= 100):
                raise HTTPException(
                    status_code=http_status.HTTP_400_BAD_REQUEST,
                    detail="percent_complete must be between 0 and 100",
                )
            report.percent_complete = data["percent_complete"]

        if "crew_size" in data:
            report.crew_size = data["crew_size"]

        if "crew_hours" in data:
            report.crew_hours = data["crew_hours"]

        if "weather" in data:
            if data["weather"]:
                try:
                    report.weather = WeatherCondition(data["weather"])
                except ValueError:
                    raise HTTPException(
                        status_code=http_status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid weather value. Must be one of: {', '.join([w.value for w in WeatherCondition])}",
                    )
            else:
                report.weather = None

        if "temperature_high" in data:
            report.temperature_high = data["temperature_high"]

        if "work_delayed" in data:
            report.work_delayed = data["work_delayed"]

        if "delay_reason" in data:
            report.delay_reason = data["delay_reason"]

        if "issues_noted" in data:
            report.issues_noted = data["issues_noted"]

        if "safety_incidents" in data:
            report.safety_incidents = data["safety_incidents"]

        if "safety_notes" in data:
            report.safety_notes = data["safety_notes"]

        if "materials_needed" in data:
            report.materials_needed = data["materials_needed"]

        if "materials_delivered" in data:
            report.materials_delivered = data["materials_delivered"]

        if "inspections_passed" in data:
            report.inspections_passed = data["inspections_passed"]

        if "inspections_failed" in data:
            report.inspections_failed = data["inspections_failed"]

        if "rework_needed" in data:
            report.rework_needed = data["rework_needed"]

        if "notes" in data:
            report.notes = data["notes"]

        # Status can only be changed via submit endpoint
        # if "status" in data and data["status"]:
        #     try:
        #         report.status = ReportStatus(data["status"])
        #     except ValueError:
        #         raise HTTPException(
        #             status_code=http_status.HTTP_400_BAD_REQUEST,
        #             detail="Invalid status. Must be one of: draft, submitted",
        #         )

        await session.commit()
        await session.refresh(report)

        logger.info(f"Report {report.id} updated by user {current_user.id}")
        return _serialize_report(report)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating daily report {report_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error updating report")


@router.delete("/{report_id}")
async def delete_daily_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Delete a daily report.

    Only creator or admin can delete.
    Only draft reports can be deleted (submitted reports cannot be deleted).
    """
    try:
        report = await _check_report_access(report_id, current_user, session, require_creator=True)

        # Check if report is locked
        if report.status == ReportStatus.SUBMITTED:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete submitted reports",
            )

        await session.delete(report)
        await session.commit()

        logger.info(f"Report {report_id} deleted by user {current_user.id}")
        return {"message": "Report deleted successfully"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting daily report {report_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error deleting report")


@router.post("/{report_id}/submit")
async def submit_daily_report(
    report_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Submit a draft report (changes status to submitted).

    Only the creator can submit their own reports.
    Reports must be in draft status to be submitted.
    """
    try:
        report = await _check_report_access(report_id, current_user, session, require_creator=True)

        if report.status == ReportStatus.SUBMITTED:
            raise HTTPException(
                status_code=http_status.HTTP_400_BAD_REQUEST,
                detail="Report is already submitted",
            )

        report.status = ReportStatus.SUBMITTED
        await session.commit()
        await session.refresh(report)

        logger.info(f"Report {report.id} submitted by user {current_user.id}")
        return _serialize_report(report)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error submitting daily report {report_id}: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error submitting report")


@router.get("/summary/stats")
async def get_summary_stats(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Get summary statistics for the reports dashboard.

    Returns:
    - total_reports_this_week: Count of reports in past 7 days
    - total_reports_this_month: Count of reports in past 30 days
    - active_communities_count: Number of unique communities with reports this month
    - total_crew_hours_this_week: Sum of crew_hours for past 7 days
    - safety_incidents_count: Count of reports with safety_incidents=true this month
    - average_crew_size: Average crew size from reports this month
    - reports_by_community: Breakdown of report count by community (this month)
    """
    try:
        now = datetime.now(timezone.utc)
        week_ago = now - timedelta(days=7)
        month_ago = now - timedelta(days=30)

        # Base query for company
        base_query = select(DailyReport).where(DailyReport.company_id == current_user.company_id)

        # Field users see only their reports
        if current_user.role == UserRole.FIELD:
            base_query = base_query.where(DailyReport.created_by_id == current_user.id)

        # This week's reports
        week_result = await session.execute(
            base_query.where(DailyReport.report_date >= week_ago)
        )
        week_reports = week_result.scalars().all()
        total_reports_this_week = len(week_reports)
        total_crew_hours_this_week = sum(r.crew_hours or 0 for r in week_reports)

        # This month's reports
        month_result = await session.execute(
            base_query.where(DailyReport.report_date >= month_ago)
        )
        month_reports = month_result.scalars().all()
        total_reports_this_month = len(month_reports)

        # Active communities (this month)
        active_communities = set(r.community for r in month_reports if r.community)
        active_communities_count = len(active_communities)

        # Safety incidents (this month)
        safety_incidents_count = sum(1 for r in month_reports if r.safety_incidents)

        # Average crew size (this month)
        crew_sizes = [r.crew_size for r in month_reports if r.crew_size is not None]
        average_crew_size = (sum(crew_sizes) / len(crew_sizes)) if crew_sizes else None

        # Reports by community (this month)
        reports_by_community = {}
        for report in month_reports:
            if report.community:
                reports_by_community[report.community] = reports_by_community.get(report.community, 0) + 1

        return {
            "total_reports_this_week": total_reports_this_week,
            "total_reports_this_month": total_reports_this_month,
            "active_communities_count": active_communities_count,
            "total_crew_hours_this_week": round(total_crew_hours_this_week, 2),
            "safety_incidents_count": safety_incidents_count,
            "average_crew_size": round(average_crew_size, 2) if average_crew_size else None,
            "reports_by_community": reports_by_community,
        }

    except Exception as e:
        logger.error(f"Error calculating summary stats: {str(e)}")
        raise HTTPException(status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error calculating stats")
