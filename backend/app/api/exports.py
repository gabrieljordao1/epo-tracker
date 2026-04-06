"""
Export endpoints — CSV and Excel downloads for EPO data.
"""

import csv
import io
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, EPO, EPOStatus

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/exports", tags=["exports"])


@router.get("/epos/csv")
async def export_epos_csv(
    status_filter: Optional[str] = Query(None),
    vendor: Optional[str] = Query(None),
    community: Optional[str] = Query(None),
    days: Optional[int] = Query(None, description="Filter EPOs from last N days"),
    limit: int = Query(5000, ge=1, le=10000, description="Max rows to export"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Export EPOs as CSV download."""
    query = select(EPO).where(EPO.company_id == current_user.company_id)

    if status_filter and status_filter != "all":
        query = query.where(EPO.status == status_filter)
    if vendor:
        query = query.where(EPO.vendor_name.ilike(f"%{vendor}%"))
    if community:
        query = query.where(EPO.community.ilike(f"%{community}%"))
    if days:
        since = datetime.utcnow() - timedelta(days=days)
        query = query.where(EPO.created_at >= since)

    query = query.order_by(EPO.created_at.desc()).limit(limit)
    result = await session.execute(query)
    epos = result.scalars().all()

    # Build CSV
    output = io.StringIO()
    writer = csv.writer(output)

    # Header row
    writer.writerow([
        "ID", "Vendor", "Vendor Email", "Community", "Lot #",
        "Description", "Amount", "Status", "Confirmation #",
        "Days Open", "Needs Review", "Confidence", "Parse Model",
        "Created At",
    ])

    for epo in epos:
        writer.writerow([
            epo.id,
            epo.vendor_name,
            epo.vendor_email,
            epo.community or "",
            epo.lot_number or "",
            epo.description or "",
            f"${epo.amount:,.2f}" if epo.amount else "",
            epo.status.value if hasattr(epo.status, 'value') else epo.status,
            epo.confirmation_number or "",
            epo.days_open or 0,
            "Yes" if epo.needs_review else "No",
            f"{epo.confidence_score:.0%}" if epo.confidence_score else "",
            epo.parse_model or "",
            epo.created_at.strftime("%Y-%m-%d %H:%M") if epo.created_at else "",
        ])

    csv_content = output.getvalue()

    # Generate filename
    date_str = datetime.utcnow().strftime("%Y-%m-%d")
    filters = []
    if status_filter:
        filters.append(status_filter)
    if vendor:
        filters.append(vendor.replace(" ", "_"))
    if community:
        filters.append(community.replace(" ", "_"))
    filter_suffix = f"_{'_'.join(filters)}" if filters else ""
    filename = f"epo_export_{date_str}{filter_suffix}.csv"

    logger.info(f"CSV export: {len(epos)} EPOs for company {current_user.company_id}")

    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/epos/summary")
async def export_summary(
    days: int = Query(30, description="Summary period in days"),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get a summary report for the given period. Returns JSON suitable for PDF generation."""
    since = datetime.utcnow() - timedelta(days=days)

    query = select(EPO).where(
        and_(
            EPO.company_id == current_user.company_id,
            EPO.created_at >= since,
        )
    )
    result = await session.execute(query)
    epos = result.scalars().all()

    total = len(epos)
    if total == 0:
        return {"period_days": days, "total": 0, "message": "No EPOs in this period"}

    confirmed = sum(1 for e in epos if e.status == EPOStatus.CONFIRMED)
    pending = sum(1 for e in epos if e.status == EPOStatus.PENDING)
    denied = sum(1 for e in epos if e.status == EPOStatus.DENIED)
    discount = sum(1 for e in epos if e.status == EPOStatus.DISCOUNT)
    total_value = sum(e.amount or 0 for e in epos)
    confirmed_value = sum(e.amount or 0 for e in epos if e.status == EPOStatus.CONFIRMED)
    denied_value = sum(e.amount or 0 for e in epos if e.status == EPOStatus.DENIED)
    avg_days = sum(e.days_open or 0 for e in epos) / total
    overdue = sum(1 for e in epos if e.status == EPOStatus.PENDING and (e.days_open or 0) >= 7)

    # Vendor breakdown
    vendor_stats = {}
    for epo in epos:
        vn = epo.vendor_name
        if vn not in vendor_stats:
            vendor_stats[vn] = {"total": 0, "confirmed": 0, "value": 0}
        vendor_stats[vn]["total"] += 1
        if epo.status == EPOStatus.CONFIRMED:
            vendor_stats[vn]["confirmed"] += 1
        vendor_stats[vn]["value"] += epo.amount or 0

    # Community breakdown
    community_stats = {}
    for epo in epos:
        comm = epo.community or "Unknown"
        if comm not in community_stats:
            community_stats[comm] = {"total": 0, "confirmed": 0, "value": 0}
        community_stats[comm]["total"] += 1
        if epo.status == EPOStatus.CONFIRMED:
            community_stats[comm]["confirmed"] += 1
        community_stats[comm]["value"] += epo.amount or 0

    return {
        "period_days": days,
        "date_from": since.strftime("%Y-%m-%d"),
        "date_to": datetime.utcnow().strftime("%Y-%m-%d"),
        "overview": {
            "total": total,
            "confirmed": confirmed,
            "pending": pending,
            "denied": denied,
            "discount": discount,
            "capture_rate": round(confirmed / total * 100) if total else 0,
            "total_value": round(total_value, 2),
            "confirmed_value": round(confirmed_value, 2),
            "denied_value": round(denied_value, 2),
            "avg_days_open": round(avg_days, 1),
            "overdue_count": overdue,
        },
        "by_vendor": [
            {
                "vendor": k,
                "total": v["total"],
                "confirmed": v["confirmed"],
                "capture_rate": round(v["confirmed"] / v["total"] * 100) if v["total"] else 0,
                "total_value": round(v["value"], 2),
            }
            for k, v in sorted(vendor_stats.items(), key=lambda x: -x[1]["value"])
        ],
        "by_community": [
            {
                "community": k,
                "total": v["total"],
                "confirmed": v["confirmed"],
                "total_value": round(v["value"], 2),
            }
            for k, v in sorted(community_stats.items(), key=lambda x: -x[1]["value"])
        ],
    }
