from typing import List, Optional, Dict, Any
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi.responses import JSONResponse
import traceback
from sqlalchemy import select, func, and_, case, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..core.security import sanitize_html, validate_email, audit_log, decrypt_token
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
    if current_user.role not in (UserRole.ADMIN, UserRole.MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )

    try:
        return await _do_backfill(session, current_user)
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Backfill fatal error: {e}\n{tb}")
        # Return JSONResponse directly to bypass global exception handler
        # which would otherwise hide the real error message
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"{type(e).__name__}: {str(e)[:300]}",
                "traceback": tb.split("\n")[-8:],
            },
        )


async def _do_backfill(session: AsyncSession, current_user: User) -> Dict[str, Any]:
    """
    Two-pass backfill:
    1. Regex on stored raw_email_subject + raw_email_body (fast, no network)
    2. For EPOs still missing amounts AND having a gmail_message_id, re-fetch
       the email from Gmail (recovers rows that stored empty body due to
       HTML-only messages synced before the HTML-fallback fix landed).
    """
    parser = EmailParserService()
    settings = get_settings()

    # Find all EPOs with missing or zero amounts for this company
    query = select(EPO).where(
        and_(
            EPO.company_id == current_user.company_id,
            or_(EPO.amount.is_(None), EPO.amount == 0),
        )
    )
    result = await session.execute(query)
    epos = list(result.scalars().all())

    updated_regex = 0
    updated_refetch = 0
    no_text = 0
    no_match = 0
    errors: List[str] = []
    details: List[str] = []
    still_missing: List[EPO] = []

    # ─── Pass 1: regex on stored text ──────────────
    for epo in epos:
        try:
            subject = epo.raw_email_subject or ""
            body = epo.raw_email_body or ""
            text = f"{subject}\n{body}".strip()
            if not text:
                still_missing.append(epo)
                continue

            amount, _confidence = parser._extract_amount(text)
            if amount and amount > 0:
                epo.amount = float(amount)
                updated_regex += 1
                details.append(f"EPO #{epo.id} [regex]: ${amount:,.2f}")
            else:
                # Subject-only sometimes contains phrasing — try subject alone too
                still_missing.append(epo)
        except Exception as e:
            errors.append(f"EPO #{epo.id}: {type(e).__name__}: {str(e)[:100]}")

    # ─── Pass 2: re-fetch from Gmail for still-missing EPOs ──────────────
    refetch_candidates = [e for e in still_missing if e.gmail_message_id]
    refetch_no_id = len(still_missing) - len(refetch_candidates)

    if refetch_candidates and settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET:
        try:
            conn_query = select(EmailConnection).where(
                EmailConnection.company_id == current_user.company_id,
                EmailConnection.provider == "gmail",
            )
            conn_result = await session.execute(conn_query)
            conn = conn_result.scalars().first()

            if conn and conn.access_token:
                gmail_api = GmailAPIService(
                    client_id=settings.GOOGLE_CLIENT_ID,
                    client_secret=settings.GOOGLE_CLIENT_SECRET,
                )
                # Decrypt tokens — they are stored encrypted in the DB
                try:
                    access_token = decrypt_token(conn.access_token, settings.SECRET_KEY)
                    refresh_token = decrypt_token(conn.refresh_token or "", settings.SECRET_KEY) if conn.refresh_token else ""
                except Exception as e:
                    errors.append(f"Token decryption failed: {type(e).__name__}: {str(e)[:100]}")
                    access_token = ""
                    refresh_token = ""

                for epo in refetch_candidates:
                    try:
                        msg = await gmail_api.get_message(
                            access_token=access_token,
                            refresh_token=refresh_token,
                            token_expires_at=conn.token_expires_at,
                            message_id=epo.gmail_message_id,
                        )
                        if not msg.get("success"):
                            err = str(msg.get("error") or "unknown")[:200]
                            errors.append(f"EPO #{epo.id} [mid={epo.gmail_message_id[:12]}]: {err}")
                            # If Google returned 401, flag connection for reconnect
                            if '"code": 401' in err or "invalid authentication" in err.lower():
                                conn.is_active = False
                            no_text += 1
                            continue

                        fetched_subj = msg.get("subject") or ""
                        fetched_body = msg.get("body") or ""
                        # Persist recovered text so we never need to re-fetch again
                        if fetched_subj and not epo.raw_email_subject:
                            epo.raw_email_subject = fetched_subj[:500]
                        if fetched_body and not epo.raw_email_body:
                            epo.raw_email_body = fetched_body

                        combined = f"{fetched_subj}\n{fetched_body}".strip()
                        if not combined:
                            no_text += 1
                            continue

                        amount, _c = parser._extract_amount(combined)
                        # Gmail call succeeded — reactivate connection if it was flagged
                        if not conn.is_active:
                            conn.is_active = True
                        if amount and amount > 0:
                            epo.amount = float(amount)
                            updated_refetch += 1
                            details.append(f"EPO #{epo.id} [gmail]: ${amount:,.2f}")
                        else:
                            no_match += 1
                    except Exception as e:
                        errors.append(f"EPO #{epo.id} refetch: {type(e).__name__}: {str(e)[:100]}")
            else:
                errors.append("No Gmail connection with access_token — skipping refetch pass")
                no_text += len(refetch_candidates)
        except Exception as e:
            errors.append(f"Refetch pass failed: {type(e).__name__}: {str(e)[:150]}")
            no_text += len(refetch_candidates)
    else:
        no_text += len(refetch_candidates)

    no_text += refetch_no_id
    updated = updated_regex + updated_refetch
    await session.commit()

    logger.info(
        f"Backfill complete: checked={len(epos)}, updated={updated} "
        f"(regex={updated_regex}, refetch={updated_refetch}), "
        f"no_text={no_text}, no_match={no_match}, errors={len(errors)}"
    )
    return {
        "total_checked": len(epos),
        "updated_total": updated,
        "updated_regex": updated_regex,
        "updated_ai": 0,
        "updated_gmail_refetch": updated_refetch,
        "skipped": no_text + no_match,
        "no_stored_text": no_text,
        "no_amount_match": no_match,
        "errors": errors[:20],
        "details": details[:100],
    }


@router.post("/reparse-all", response_model=Dict[str, Any])
async def reparse_all_epos(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Full re-extraction pass over every EPO in the company:
    - Runs v6 Gemini classifier+extractor on stored raw_email_subject+body
    - Updates vendor_name (builder), community, lot_number, description, amount
    - If classifier returns is_epo=false, marks row archived=True (non-destructive)
    - Never creates new rows, never deletes rows
    """
    if current_user.role not in (UserRole.ADMIN, UserRole.MANAGER):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin/Manager access required",
        )

    try:
        parser = EmailParserService()
        query = select(EPO).where(EPO.company_id == current_user.company_id)
        result = await session.execute(query)
        epos = list(result.scalars().all())

        reparsed = 0
        builder_fixed = 0
        amount_fixed = 0
        desc_fixed = 0
        archived_not_epo = 0
        skipped_no_text = 0
        errors: List[str] = []
        details: List[Dict[str, Any]] = []

        for epo in epos:
            subject = epo.raw_email_subject or ""
            body = epo.raw_email_body or ""
            if not (subject or body):
                skipped_no_text += 1
                continue
            try:
                parsed = await parser.parse_email(
                    email_subject=subject,
                    email_body=body,
                    vendor_email=epo.vendor_email or "",
                )
            except Exception as e:
                errors.append(f"EPO #{epo.id}: {type(e).__name__}: {str(e)[:120]}")
                continue

            if not parsed:
                continue

            # Not an EPO per new classifier — hard delete the auto-created junk row
            if parsed.get("is_epo") is False:
                details.append({"id": epo.id, "action": "deleted_not_epo", "subject": subject[:80]})
                await session.delete(epo)
                archived_not_epo += 1
                continue

            changes: Dict[str, Any] = {}

            # Builder — only adopt a value that's a real company, not a person or email provider
            from ..services.email_parser import _is_bad_builder_name, _looks_like_bad_lot
            new_builder = parsed.get("builder_name") or parsed.get("vendor_name")
            if new_builder and _is_bad_builder_name(new_builder):
                new_builder = None
            # Wipe any existing bad builder (person's name, email provider, etc.)
            if epo.vendor_name and _is_bad_builder_name(epo.vendor_name):
                epo.vendor_name = "Unknown Builder"
                changes["vendor_name_cleared"] = True
                builder_fixed += 1
            if new_builder and new_builder != epo.vendor_name:
                current = (epo.vendor_name or "").strip()
                if current in ("", "Unknown Builder"):
                    changes["vendor_name"] = new_builder
                    epo.vendor_name = new_builder
                    builder_fixed += 1

            # Community
            new_comm = parsed.get("community")
            if new_comm and new_comm != epo.community:
                changes["community"] = new_comm
                epo.community = new_comm

            # Lot — if Gemini returned "2b and 2c" or "25,26,27" pick the first concrete lot
            new_lot = parsed.get("lot_number")
            if isinstance(new_lot, str):
                # Split on commas, " and ", or whitespace — take first non-empty token
                parts = re.split(r"[,;]| and |\s+", new_lot.strip())
                parts = [p for p in (pp.strip() for pp in parts) if p and p.lower() not in ("and", "or")]
                if parts and len(parts[0]) <= 10:
                    new_lot = parts[0]
            if new_lot and new_lot != epo.lot_number:
                # Reject garbage single-letter lots
                if not _looks_like_bad_lot(new_lot):
                    changes["lot_number"] = new_lot
                    epo.lot_number = new_lot
            # Actively clear existing bad lot values (e.g., "s", "a")
            if epo.lot_number and _looks_like_bad_lot(epo.lot_number):
                epo.lot_number = None
                changes["lot_number_cleared"] = True

            # Description — replace if new one is clearly better (longer, not truncated)
            new_desc = parsed.get("description")
            if new_desc and new_desc != epo.description:
                old = (epo.description or "").strip()
                # Prefer new if old is blank, truncated (ends mid-word), or clearly shorter
                old_looks_truncated = (
                    not old
                    or old.endswith((" and", " to", " the", " of", " for", " in", " with"))
                    or len(old) < 20
                )
                if old_looks_truncated or len(new_desc) > len(old) + 10:
                    changes["description"] = new_desc[:500]
                    epo.description = new_desc[:500]
                    desc_fixed += 1

            # Amount
            new_amt = parsed.get("amount")
            try:
                new_amt_f = float(new_amt) if new_amt is not None else None
            except (TypeError, ValueError):
                new_amt_f = None
            if new_amt_f and new_amt_f > 0:
                if epo.amount in (None, 0) or abs((epo.amount or 0) - new_amt_f) > 0.01:
                    changes["amount"] = new_amt_f
                    epo.amount = new_amt_f
                    amount_fixed += 1

            if changes:
                reparsed += 1
                details.append({"id": epo.id, "changes": changes})

        await session.commit()

        return {
            "total_checked": len(epos),
            "reparsed": reparsed,
            "builder_fixed": builder_fixed,
            "amount_fixed": amount_fixed,
            "description_fixed": desc_fixed,
            "archived_not_epo": archived_not_epo,
            "skipped_no_text": skipped_no_text,
            "errors": errors[:20],
            "details": details[:50],
        }
    except Exception as e:
        tb = traceback.format_exc()
        logger.error(f"Reparse fatal error: {e}\n{tb}")
        return JSONResponse(
            status_code=500,
            content={
                "detail": f"{type(e).__name__}: {str(e)[:300]}",
                "traceback": tb.split("\n")[-8:],
            },
        )
