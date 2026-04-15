"""
Sub Payments / Profit Tracker API.

Tracks payments to subcontractors (drywaller, painter, etc.) against each EPO
so field managers can see net profit per EPO and across all EPOs.
"""

from typing import List, Optional, Dict, Any
from datetime import datetime
import logging

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import EPO, SubPayment, User, EPOStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sub-payments", tags=["sub-payments"])


# ─── Schemas ──────────────────────────────────────────────

class SubPaymentCreate(BaseModel):
    epo_id: int
    sub_name: str = Field(..., min_length=1, max_length=255)
    sub_trade: str = Field(..., min_length=1, max_length=100)
    amount: float = Field(..., gt=0)
    paid_date: Optional[datetime] = None
    notes: Optional[str] = None


class SubPaymentUpdate(BaseModel):
    sub_name: Optional[str] = None
    sub_trade: Optional[str] = None
    amount: Optional[float] = None
    paid_date: Optional[datetime] = None
    notes: Optional[str] = None


class SubPaymentResponse(BaseModel):
    id: int
    epo_id: int
    sub_name: str
    sub_trade: str
    amount: float
    paid_date: Optional[datetime]
    notes: Optional[str]
    created_at: datetime

    class Config:
        from_attributes = True


class EPOProfitSummary(BaseModel):
    epo_id: int
    vendor_name: str
    community: Optional[str]
    lot_number: Optional[str]
    description: Optional[str]
    epo_amount: float
    total_paid_subs: float
    net_profit: float
    profit_margin: float
    payments: List[SubPaymentResponse]
    status: str
    created_at: datetime


class ProfitOverview(BaseModel):
    total_revenue: float
    total_paid_subs: float
    total_net_profit: float
    avg_profit_margin: float
    epo_count: int
    payment_count: int


class ProfitSummaryResponse(BaseModel):
    overview: ProfitOverview
    epos: List[EPOProfitSummary]


# ─── Endpoints ────────────────────────────────────────────

@router.get("", response_model=List[SubPaymentResponse])
async def list_sub_payments(
    epo_id: Optional[int] = Query(None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """List sub payments, optionally filtered by EPO."""
    query = select(SubPayment).where(
        SubPayment.company_id == current_user.company_id
    )
    if epo_id is not None:
        query = query.where(SubPayment.epo_id == epo_id)
    query = query.order_by(SubPayment.created_at.desc())

    result = await session.execute(query)
    payments = result.scalars().all()
    return [SubPaymentResponse.model_validate(p) for p in payments]


@router.post("", response_model=SubPaymentResponse)
async def create_sub_payment(
    payload: SubPaymentCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a new sub payment against an EPO."""
    # Verify the EPO exists and belongs to the user's company
    epo_result = await session.execute(
        select(EPO).where(
            and_(EPO.id == payload.epo_id, EPO.company_id == current_user.company_id)
        )
    )
    epo = epo_result.scalars().first()
    if not epo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="EPO not found"
        )

    payment = SubPayment(
        company_id=current_user.company_id,
        epo_id=payload.epo_id,
        created_by_id=current_user.id,
        sub_name=payload.sub_name,
        sub_trade=payload.sub_trade,
        amount=payload.amount,
        paid_date=payload.paid_date,
        notes=payload.notes,
    )
    session.add(payment)
    await session.flush()
    await session.commit()
    await session.refresh(payment)
    return SubPaymentResponse.model_validate(payment)


@router.put("/{payment_id}", response_model=SubPaymentResponse)
async def update_sub_payment(
    payment_id: int,
    payload: SubPaymentUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update a sub payment."""
    result = await session.execute(
        select(SubPayment).where(
            and_(
                SubPayment.id == payment_id,
                SubPayment.company_id == current_user.company_id,
            )
        )
    )
    payment = result.scalars().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(payment, key, value)

    await session.commit()
    await session.refresh(payment)
    return SubPaymentResponse.model_validate(payment)


@router.delete("/{payment_id}")
async def delete_sub_payment(
    payment_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Delete a sub payment."""
    result = await session.execute(
        select(SubPayment).where(
            and_(
                SubPayment.id == payment_id,
                SubPayment.company_id == current_user.company_id,
            )
        )
    )
    payment = result.scalars().first()
    if not payment:
        raise HTTPException(status_code=404, detail="Payment not found")

    await session.delete(payment)
    await session.commit()
    return {"deleted": True}


@router.get("/profit-summary", response_model=ProfitSummaryResponse)
async def profit_summary(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get profit summary across all EPOs with sub payments tracked.

    Returns overview totals + per-EPO breakdown with net profit calculation:
    net_profit = epo.amount - sum(sub_payments.amount)
    """
    # Load all EPOs with their sub payments
    epo_result = await session.execute(
        select(EPO)
        .where(EPO.company_id == current_user.company_id)
        .options(selectinload(EPO.sub_payments))
        .order_by(EPO.created_at.desc())
    )
    epos = epo_result.scalars().all()

    total_revenue = 0.0
    total_paid = 0.0
    total_profit = 0.0
    margins = []
    payment_count = 0
    epo_summaries: List[EPOProfitSummary] = []

    for epo in epos:
        epo_amount = float(epo.amount or 0)
        total_paid_subs = sum(float(p.amount or 0) for p in epo.sub_payments)
        net_profit = epo_amount - total_paid_subs
        margin = (
            (net_profit / epo_amount * 100.0) if epo_amount > 0 else 0.0
        )

        # Only include EPOs that have at least one payment OR have an amount
        # Show all EPOs so user can add payments
        total_revenue += epo_amount
        total_paid += total_paid_subs
        total_profit += net_profit
        payment_count += len(epo.sub_payments)
        if epo_amount > 0:
            margins.append(margin)

        epo_summaries.append(
            EPOProfitSummary(
                epo_id=epo.id,
                vendor_name=epo.vendor_name or "Unknown",
                community=epo.community,
                lot_number=epo.lot_number,
                description=epo.description,
                epo_amount=epo_amount,
                total_paid_subs=total_paid_subs,
                net_profit=net_profit,
                profit_margin=margin,
                payments=[
                    SubPaymentResponse.model_validate(p) for p in epo.sub_payments
                ],
                status=epo.status.value if epo.status else "pending",
                created_at=epo.created_at,
            )
        )

    overview = ProfitOverview(
        total_revenue=total_revenue,
        total_paid_subs=total_paid,
        total_net_profit=total_profit,
        avg_profit_margin=(sum(margins) / len(margins)) if margins else 0.0,
        epo_count=len(epos),
        payment_count=payment_count,
    )

    return ProfitSummaryResponse(overview=overview, epos=epo_summaries)
