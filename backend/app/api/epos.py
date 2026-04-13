from typing import List, Optional, Dict, Any
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, func, and_, case, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..core.security import sanitize_html, validate_email, audit_log
from ..models.models import EPO, EPOFollowup, EmailConnection, User, EPOStatus, UserRole
from ..services.email_parser import EmailParserService
from ..services.gmail_api import GmailAPIService
from ..core.config import get_settings
from ..models.schemas import (
    EPOCreate,
    EPOUpdate,
    EPOResponse,
    EPODetailResponse,
    EPOStats,
    DashboardStats,
    EPOFollowupResponse,
    EPOFollowupCreate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/epos", tags=["epos"])


@router.post("", response_model=EPOResponse)
async def create_epo(
    epo_create: EPOCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EPOResponse:
    """Create a new EPO"""
    try:
        # Input validation
        if not validate_email(epo_create.vendor_email):
            audit_log(
                event_type="epo_creation_failed",
                user_id=str(current_user.id),
                email=current_user.email,
                status="failure",
                error_message="Invalid vendor email format",
                details={"vendor_email": epo_create.vendor_email}
            )
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid vendor email format"
            )

        # Sanitize text fields
        vendor_name = sanitize_html(epo_create.vendor_name, allowed_tags=[])
        description = sanitize_html(epo_create.description or "", allowed_tags=[])
        community = sanitize_html(epo_create.community or "", allowed_tags=[])

        epo = EPO(
            company_id=current_user.company_id,
            created_by_id=current_user.id,
            vendor_name=vendor_name,
            vendor_email=epo_create.vendor_email,
            description=description,
            community=community,
            **{k: v for k, v in epo_create.model_dump().items()
               if k not in ['vendor_name', 'vendor_email', 'description', 'community']},
        )
        session.add(epo)
        await session.commit()
        await session.refresh(epo)

        audit_log(
            event_type="epo_created",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"epo_id": epo.id, "vendor_name": vendor_name}
        )
        return EPOResponse.model_validate(epo)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating EPO: {str(e)}")
        audit_log(
            event_type="epo_creation_failed",
            user_id=str(current_user.id),
            email=current_user.email,
            status="failure",
            error_message=str(e)
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create EPO"
        )


@router.get("", response_model=List[EPOResponse])
async def list_epos(
    status_filter: Optional[EPOStatus] = Query(None),
    vendor: Optional[str] = Query(None),
    community: Optional[str] = Query(None),
    needs_review: Optional[bool] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> List[EPOResponse]:
    """List EPOs for the current company with filtering.
    Field role users only see their own EPOs. Admin/Manager see all company EPOs.
    """
    try:
        query = select(EPO).where(EPO.company_id == current_user.company_id)

        # Field users only see their own EPOs
        if current_user.role == UserRole.FIELD:
            query = query.where(EPO.created_by_id == current_user.id)

        if status_filter:
            query = query.where(EPO.status == status_filter)

        if vendor:
            query = query.where(EPO.vendor_name.ilike(f"%{vendor}%"))

        if community:
            query = query.where(EPO.community.ilike(f"%{community}%"))

        if needs_review is not None:
            query = query.where(EPO.needs_review == needs_review)

        query = query.order_by(EPO.created_at.desc()).offset(skip).limit(limit)

        result = await session.execute(query)
        epos = result.scalars().all()
        return [EPOResponse.model_validate(epo) for epo in epos]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error listing EPOs: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve EPOs"
        )


@router.get("/{epo_id}", response_model=EPODetailResponse)
async def get_epo(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EPODetailResponse:
    """Get a specific EPO with followups"""
    try:
        query = (
            select(EPO)
            .options(selectinload(EPO.followups))
            .where(and_(EPO.id == epo_id, EPO.company_id == current_user.company_id))
        )
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="EPO not found",
            )

        return EPODetailResponse.model_validate(epo)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving EPO {epo_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve EPO"
        )


@router.put("/{epo_id}", response_model=EPOResponse)
async def update_epo(
    epo_id: int,
    epo_update: EPOUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EPOResponse:
    """Update an EPO"""
    try:
        query = select(EPO).where(
            and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
        )
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="EPO not found",
            )

        # Optimistic locking: if client sent a version, verify it matches
        update_data = epo_update.model_dump(exclude_unset=True)
        client_version = update_data.pop("version", None)
        if client_version is not None and hasattr(epo, "version") and epo.version != client_version:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This EPO was modified by someone else. Please refresh and try again.",
            )

        # Update only provided fields with sanitization
        for field, value in update_data.items():
            if field in ['vendor_name', 'description', 'community'] and value:
                value = sanitize_html(str(value), allowed_tags=[])
            setattr(epo, field, value)

        # Increment version for optimistic locking
        if hasattr(epo, "version"):
            epo.version = (epo.version or 1) + 1

        await session.commit()
        await session.refresh(epo)

        audit_log(
            event_type="epo_updated",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"epo_id": epo.id}
        )
        return EPOResponse.model_validate(epo)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating EPO {epo_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update EPO"
        )


@router.get("/stats/dashboard", response_model=DashboardStats)
async def get_dashboard_stats(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> DashboardStats:
    """Get dashboard statistics and analytics for EPOs.
    Field role users see stats for their own EPOs only.
    Optimized: single aggregate query instead of 8 separate queries.
    """
    try:
        company_id = current_user.company_id

        # Base filter: company scope + optional user scope for field users
        scope_filters = [EPO.company_id == company_id]
        if current_user.role == UserRole.FIELD:
            scope_filters.append(EPO.created_by_id == current_user.id)

        # Single query for all counts + aggregates (replaces 8 queries)
        stats_query = select(
            func.count(EPO.id).label("total_epos"),
            func.count(case((EPO.status == EPOStatus.PENDING, 1))).label("pending_count"),
            func.count(case((EPO.status == EPOStatus.CONFIRMED, 1))).label("confirmed_count"),
            func.count(case((EPO.status == EPOStatus.DENIED, 1))).label("denied_count"),
            func.count(case((EPO.status == EPOStatus.DISCOUNT, 1))).label("discount_count"),
            func.count(case((EPO.needs_review.is_(True), 1))).label("needs_review_count"),
            func.avg(EPO.amount).label("average_amount"),
            func.sum(EPO.amount).label("total_amount"),
            func.avg(EPO.days_open).label("avg_days_open"),
        ).where(and_(*scope_filters))

        stats_result = await session.execute(stats_query)
        row = stats_result.one()

        total_epos = row.total_epos or 0
        pending_count = row.pending_count or 0
        confirmed_count = row.confirmed_count or 0
        denied_count = row.denied_count or 0
        discount_count = row.discount_count or 0
        needs_review_count = row.needs_review_count or 0
        average_amount = row.average_amount
        total_amount = row.total_amount
        avg_days_open = row.avg_days_open

        stats = EPOStats(
            total_epos=total_epos,
            pending_count=pending_count,
            confirmed_count=confirmed_count,
            denied_count=denied_count,
            discount_count=discount_count,
            needs_review_count=needs_review_count,
            average_amount=average_amount,
            total_amount=total_amount,
            avg_days_open=avg_days_open,
        )

        # Get recent EPOs
        recent_epos_query = select(EPO).where(and_(*scope_filters)).order_by(EPO.created_at.desc()).limit(10)
        recent_epos_result = await session.execute(recent_epos_query)
        recent_epos = [
            EPOResponse.model_validate(epo) for epo in recent_epos_result.scalars().all()
        ]

        return DashboardStats(
            stats=stats,
            recent_epos=recent_epos,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error retrieving dashboard stats: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve dashboard statistics"
        )


@router.post("/{epo_id}/followup", response_model=EPOFollowupResponse)
async def create_followup(
    epo_id: int,
    followup_create: EPOFollowupCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> EPOFollowupResponse:
    """Create a followup for an EPO"""
    try:
        # Verify EPO exists and belongs to company
        query = select(EPO).where(
            and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
        )
        result = await session.execute(query)
        epo = result.scalars().first()

        if not epo:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="EPO not found",
            )

        followup = EPOFollowup(
            company_id=current_user.company_id,
            epo_id=epo_id,
            **followup_create.model_dump(),
        )
        session.add(followup)
        await session.commit()
        await session.refresh(followup)

        audit_log(
            event_type="epo_followup_created",
            user_id=str(current_user.id),
            email=current_user.email,
            status="success",
            details={"epo_id": epo_id, "followup_id": followup.id}
        )
        return EPOFollowupResponse.model_validate(followup)
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating followup for EPO {epo_id}: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create followup"
        )


@router.post("/backfill-amounts", response_model=Dict[str, Any])
async def backfill_epo_amounts(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Re-parse amounts for EPOs that have null or zero amounts.

    Strategy (3-pass):
    1. Regex on stored raw_email_subject + raw_email_body (fast, free)
    2. AI re-parse on stored subject + body via Gemini/Haiku
    3. For EPOs with empty body but a gmail_message_id: re-fetch from Gmail,
       extract body (now with HTML support), then AI parse
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.OWNER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    settings = get_settings()
    parser = EmailParserService(
        anthropic_api_key=settings.ANTHROPIC_API_KEY,
    )

    # Find ALL EPOs with missing or zero amounts
    query = select(EPO).where(
        and_(
            EPO.company_id == current_user.company_id,
            or_(EPO.amount == None, EPO.amount == 0),  # noqa: E711
        )
    )
    result = await session.execute(query)
    epos = result.scalars().all()

    updated_regex = 0
    updated_ai = 0
    updated_refetch = 0
    skipped = 0
    errors = []
    details = []

    # ── PASS 1: Quick regex on stored text ──────────────────────────
    still_missing = []
    for epo in epos:
        try:
            text = f"{epo.raw_email_subject or ''}\n{epo.raw_email_body or ''}"
            if text.strip():
                amount, confidence = parser._extract_amount(text)
                if amount and amount > 0:
                    epo.amount = amount
                    updated_regex += 1
                    details.append(f"EPO #{epo.id}: regex -> ${amount:,.2f}")
                    continue
            still_missing.append(epo)
        except Exception as e:
            errors.append(f"EPO #{epo.id} regex: {str(e)}")
            still_missing.append(epo)

    # ── PASS 2: AI re-parse on stored text ──────────────────────────
    still_missing_after_ai = []
    for epo in still_missing:
        subject = epo.raw_email_subject or ""
        body = epo.raw_email_body or ""
        if not subject.strip() and not body.strip():
            still_missing_after_ai.append(epo)
            continue

        try:
            parsed = await parser.parse_email(
                email_subject=subject,
                email_body=body,
                vendor_email=epo.vendor_email,
            )
            if parsed and parsed.get("amount"):
                amount = parsed["amount"]
                if isinstance(amount, (int, float)) and amount > 0:
                    epo.amount = float(amount)
                    updated_ai += 1
                    details.append(
                        f"EPO #{epo.id}: AI ({parsed.get('parse_model')}) "
                        f"-> ${float(amount):,.2f}"
                    )
                    continue
            still_missing_after_ai.append(epo)
        except Exception as e:
            errors.append(f"EPO #{epo.id} AI: {str(e)}")
            still_missing_after_ai.append(epo)

    # ── PASS 3: Re-fetch from Gmail for EPOs with empty body ────────
    # Group EPOs by email_connection_id to minimize credential lookups
    gmail_api = GmailAPIService()
    conn_cache: Dict[int, Any] = {}

    for epo in still_missing_after_ai:
        if not epo.gmail_message_id or not epo.email_connection_id:
            skipped += 1
            continue

        try:
            # Get email connection credentials (cached)
            conn_id = epo.email_connection_id
            if conn_id not in conn_cache:
                conn_result = await session.execute(
                    select(EmailConnection).where(
                        and_(
                            EmailConnection.id == conn_id,
                            EmailConnection.is_active == True,  # noqa: E712
                        )
                    )
                )
                conn_cache[conn_id] = conn_result.scalars().first()

            conn = conn_cache[conn_id]
            if not conn or not conn.access_token:
                skipped += 1
                continue

            # Re-fetch the message from Gmail
            msg = await gmail_api.get_message(
                access_token=conn.access_token,
                refresh_token=conn.refresh_token,
                token_expires_at=conn.token_expires_at,
                message_id=epo.gmail_message_id,
            )

            if not msg.get("success"):
                skipped += 1
                continue

            new_body = msg.get("body", "")
            new_subject = msg.get("subject", "") or epo.raw_email_subject or ""

            if not new_body.strip():
                skipped += 1
                continue

            # Update stored body if it was empty before
            if not epo.raw_email_body or not epo.raw_email_body.strip():
                epo.raw_email_body = new_body
                logger.info(
                    f"EPO #{epo.id}: backfilled empty raw_email_body "
                    f"({len(new_body)} chars)"
                )

            # Try regex first on the new body
            text = f"{new_subject}\n{new_body}"
            amount, confidence = parser._extract_amount(text)
            if amount and amount > 0:
                epo.amount = amount
                updated_refetch += 1
                details.append(f"EPO #{epo.id}: Gmail refetch+regex -> ${amount:,.2f}")
                continue

            # Try full AI parse on the new body
            parsed = await parser.parse_email(
                email_subject=new_subject,
                email_body=new_body,
                vendor_email=epo.vendor_email,
            )
            if parsed and parsed.get("amount"):
                amt = parsed["amount"]
                if isinstance(amt, (int, float)) and amt > 0:
                    epo.amount = float(amt)
                    updated_refetch += 1
                    details.append(
                        f"EPO #{epo.id}: Gmail refetch+AI "
                        f"({parsed.get('parse_model')}) -> ${float(amt):,.2f}"
                    )
                    continue

            skipped += 1

        except Exception as e:
            errors.append(f"EPO #{epo.id} Gmail: {str(e)}")
            logger.error(f"Backfill Gmail error EPO #{epo.id}: {e}")

    await session.flush()

    total_updated = updated_regex + updated_ai + updated_refetch
    return {
        "total_checked": len(epos),
        "updated_total": total_updated,
        "updated_regex": updated_regex,
        "updated_ai": updated_ai,
        "updated_gmail_refetch": updated_refetch,
        "skipped": skipped,
        "errors": errors,
        "details": details,
    }
