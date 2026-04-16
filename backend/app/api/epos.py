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
        deleted_ids: set = set()  # track EPOs removed during iteration

        # ── Pre-pass: delete multi-lot duplicates from previous reparse runs ──
        # Keep only the lowest-ID EPO per gmail_message_id
        by_gmail: Dict[str, List[EPO]] = {}
        for epo in epos:
            if epo.gmail_message_id:
                by_gmail.setdefault(epo.gmail_message_id, []).append(epo)
        for gmail_id, group in by_gmail.items():
            if len(group) > 1:
                group_sorted = sorted(group, key=lambda e: e.id)
                # Keep the lowest-ID one, delete the rest (will be re-created with correct amounts)
                for dup in group_sorted[1:]:
                    details.append({"id": dup.id, "action": "pre_cleanup_multi_lot_dup", "lot": dup.lot_number, "gmail_id": gmail_id})
                    deleted_ids.add(dup.id)
                    await session.delete(dup)
        await session.flush()

        for epo in epos:
            if epo.id in deleted_ids:
                continue
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
            from ..services.email_parser import (
                _is_bad_builder_name, _looks_like_bad_lot, _is_bad_community,
                _normalize_builder, _normalize_community, _parse_epo_subject,
                _extract_total_amount, _extract_original_epo_description,
            )

            # Subject-based extraction is MOST reliable — do it first
            subj_parsed = _parse_epo_subject(subject)

            # Builder — prefer subject, then Gemini, then normalize
            new_builder = (
                subj_parsed.get("builder_name")
                or _normalize_builder(parsed.get("builder_name") or parsed.get("vendor_name") or "")
            )
            if epo.vendor_name:
                if _is_bad_builder_name(epo.vendor_name):
                    epo.vendor_name = "Unknown Builder"
                    changes["vendor_name_cleared"] = True
                    builder_fixed += 1
                else:
                    # Normalize existing (e.g., "Drhorton" → "DR Horton")
                    norm_existing = _normalize_builder(epo.vendor_name)
                    if norm_existing and norm_existing != epo.vendor_name:
                        epo.vendor_name = norm_existing
                        changes["vendor_name_normalized"] = norm_existing
                        builder_fixed += 1
            if new_builder and new_builder != epo.vendor_name:
                current = (epo.vendor_name or "").strip()
                if current in ("", "Unknown Builder"):
                    changes["vendor_name"] = new_builder
                    epo.vendor_name = new_builder
                    builder_fixed += 1

            # Community — prefer subject, then Gemini; always normalize; clear bad
            new_comm = subj_parsed.get("community") or _normalize_community(parsed.get("community") or "")
            if epo.community and _is_bad_community(epo.community):
                epo.community = None
                changes["community_cleared"] = True
            if new_comm and new_comm != epo.community:
                changes["community"] = new_comm
                epo.community = new_comm

            # ── Amount — extract FIRST so multi-lot expansion uses the correct value ──
            total_amt = _extract_total_amount(body, subject)
            new_amt = total_amt if total_amt else parsed.get("amount")
            try:
                new_amt_f = float(new_amt) if new_amt is not None else None
            except (TypeError, ValueError):
                new_amt_f = None
            if new_amt_f and new_amt_f > 0:
                if epo.amount in (None, 0) or abs((epo.amount or 0) - new_amt_f) > 0.01:
                    changes["amount"] = new_amt_f
                    epo.amount = new_amt_f
                    amount_fixed += 1

            # ── Description ──
            from ..services.email_parser import _extract_work_description
            new_desc = _extract_work_description(body)
            old = (epo.description or "").strip()
            old_low = old.lower()
            old_is_boilerplate_or_bad = (
                not old
                or len(old) < 25
                or old_low.startswith(("please submit", "submit an", "re:", "any chance", "got returned", "were these", "no i do not", "yes", "no ", "extra paint", "hello sir", "hi ", "afternoon", "morning"))
                or "[cid:" in old
                or "gabriel jordao" in old_low
                or "field manager" in old_low
                or old.endswith((" and", " to", " the", " of", " for", " in", " with"))
            )
            if new_desc and new_desc != epo.description and old_is_boilerplate_or_bad:
                if "gabriel jordao" not in new_desc.lower() and "field manager" not in new_desc.lower():
                    changes["description"] = new_desc[:500]
                    epo.description = new_desc[:500]
                    desc_fixed += 1
            elif old_is_boilerplate_or_bad:
                epo.description = None
                epo.needs_review = True
                changes["description_cleared"] = True
                desc_fixed += 1

            # ── Lot — expand multi-lot emails into separate EPOs ──
            from ..services.email_parser import _expand_lot_list, _extract_lots_from_subject
            first_lot_subj, lot_count, lot_range_str = _extract_lots_from_subject(subject)
            new_lot = subj_parsed.get("lot_number") or parsed.get("lot_number")

            all_lots = []
            if first_lot_subj and lot_count > 1:
                raw_lots_str = re.search(
                    r"lots?\s+([\d][\w,\s\-&]*?(?:(?:\s*,\s*|\s+and\s+|\s+&\s+)\d+[\w]*)*)\s+[A-Za-z]",
                    re.sub(r"^\s*((re|fwd|fw)\s*:\s*)+", "", subject, flags=re.IGNORECASE),
                    re.IGNORECASE,
                )
                if raw_lots_str:
                    all_lots = _expand_lot_list(raw_lots_str.group(1))
                if not all_lots:
                    all_lots = _expand_lot_list(lot_range_str or "")
            elif isinstance(new_lot, str):
                expanded = _expand_lot_list(new_lot)
                if len(expanded) > 1:
                    all_lots = expanded
                else:
                    parts = re.split(r"[,;]| and |\s+", new_lot.strip())
                    parts = [p for p in (pp.strip() for pp in parts) if p and p.lower() not in ("and", "or")]
                    if parts and len(parts[0]) <= 10:
                        new_lot = parts[0].strip(",;. ")

            if all_lots and len(all_lots) > 1:
                # Assign FIRST lot to this EPO
                first = all_lots[0]
                if first != epo.lot_number:
                    changes["lot_number"] = first
                    epo.lot_number = first

                # ── Per-lot amount: extract directly from email body ──
                body_clean = re.sub(r"<[^>]+>", " ", epo.raw_email_body or "")
                body_clean = re.sub(r"&nbsp;", " ", body_clean)
                body_clean = re.sub(r"\s+", " ", body_clean)

                per_lot_amt = None
                # Look for explicit "X per lot" pattern in email
                per_lot_matches = re.findall(
                    r"(?:epo\s+of\s+)?\$?\s*([\d,]+(?:\.\d{1,2})?)\s+per\s+lot",
                    body_clean, re.IGNORECASE,
                )
                if per_lot_matches:
                    unique_amounts = list(set(
                        float(m.replace(",", "")) for m in per_lot_matches
                    ))
                    if len(unique_amounts) == 1:
                        # Single per-lot price — use it for every lot
                        per_lot_amt = unique_amounts[0]
                        epo.amount = per_lot_amt
                        changes["amount_per_lot_from_email"] = per_lot_amt

                # Fallback: divide total by lot count
                if per_lot_amt is None and epo.amount and epo.amount > 0:
                    per_lot_amt = round(epo.amount / len(all_lots), 2)
                    if abs(epo.amount - per_lot_amt) > 0.01:
                        epo.amount = per_lot_amt
                        changes["amount_per_lot"] = per_lot_amt

                # Create NEW EPOs for remaining lots (2nd, 3rd, etc.)
                # Note: previous-reparse dupes already cleaned in pre-pass above
                import secrets
                for extra_lot in all_lots[1:]:
                    extra_epo = EPO(
                        company_id=current_user.company_id,
                        created_by_id=epo.created_by_id,
                        email_connection_id=epo.email_connection_id,
                        vendor_name=epo.vendor_name,
                        vendor_email=epo.vendor_email,
                        community=epo.community,
                        lot_number=extra_lot,
                        description=epo.description,
                        amount=per_lot_amt,
                        status=epo.status,
                        confirmation_number=epo.confirmation_number,
                        confidence_score=epo.confidence_score,
                        parse_model=epo.parse_model,
                        raw_email_subject=epo.raw_email_subject,
                        raw_email_body=epo.raw_email_body,
                        synced_from_email=True,
                        vendor_token=secrets.token_urlsafe(32),
                        needs_review=epo.needs_review,
                        gmail_thread_id=epo.gmail_thread_id,
                        gmail_message_id=epo.gmail_message_id,
                    )
                    session.add(extra_epo)
                    details.append({"id": f"new_lot_{extra_lot}", "parent_epo": epo.id, "lot": extra_lot, "amount": per_lot_amt, "action": "created_from_multi_lot"})
                changes["multi_lot_expanded"] = all_lots
            else:
                # Single lot handling
                if isinstance(new_lot, str):
                    new_lot = new_lot.strip(",;. ")
                if new_lot and not _looks_like_bad_lot(new_lot) and new_lot != epo.lot_number:
                    changes["lot_number"] = new_lot
                    epo.lot_number = new_lot

            if epo.lot_number and _looks_like_bad_lot(epo.lot_number):
                epo.lot_number = None
                changes["lot_number_cleared"] = True
            if epo.lot_number and isinstance(epo.lot_number, str):
                stripped = epo.lot_number.strip(",;. ")
                if stripped and stripped != epo.lot_number:
                    epo.lot_number = stripped
                    changes["lot_number_trimmed"] = stripped

            if changes:
                reparsed += 1
                details.append({"id": epo.id, "changes": changes})

        # Flush so subsequent dedup query sees updates
        await session.flush()

        # Dedupe: for each (vendor_name, community, lot_number, amount) keep lowest-id
        dedup_query = select(EPO).where(EPO.company_id == current_user.company_id)
        all_epos = (await session.execute(dedup_query)).scalars().all()
        seen: Dict[tuple, int] = {}
        duped = 0
        for e in sorted(all_epos, key=lambda x: x.id):
            key = (
                (e.vendor_name or "").strip().lower(),
                (e.community or "").strip().lower(),
                (e.lot_number or "").strip().lower() if e.lot_number else "",
                round(float(e.amount or 0), 2),
            )
            # Only dedupe when all 4 fields are meaningfully set
            if not key[0] or not key[1] or not key[2] or key[3] <= 0:
                continue
            if key in seen:
                details.append({"id": e.id, "action": "deleted_duplicate_of", "kept": seen[key]})
                await session.delete(e)
                duped += 1
            else:
                seen[key] = e.id

        await session.commit()

        return {
            "total_checked": len(epos),
            "reparsed": reparsed,
            "builder_fixed": builder_fixed,
            "amount_fixed": amount_fixed,
            "description_fixed": desc_fixed,
            "archived_not_epo": archived_not_epo,
            "duplicates_deleted": duped,
            "skipped_no_text": skipped_no_text,
            "errors": errors[:20],
            "details": details[:80],
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
