"""
EPO Lot Items API.

Tracks per-lot breakdown for multi-lot EPOs. When an EPO covers lots 1-4,
each lot gets its own LotItem row with individual amount, description, and notes.
"""

from typing import List, Optional
from datetime import datetime
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import EPO, EPOLotItem, User
from ..services.email_parser import (
    _extract_tiered_per_lot_amounts,
    _extract_individual_lot_amounts,
    _extract_individual_lot_descriptions,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/epos", tags=["lot-items"])


# ─── Schemas ──────────────────────────────────────────────

class EPOLotItemCreate(BaseModel):
    lot_number: str = Field(..., min_length=1, max_length=50)
    amount: Optional[float] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class EPOLotItemUpdate(BaseModel):
    lot_number: Optional[str] = None
    amount: Optional[float] = None
    description: Optional[str] = None
    notes: Optional[str] = None


class EPOLotItemResponse(BaseModel):
    id: int
    epo_id: int
    lot_number: str
    amount: Optional[float]
    description: Optional[str]
    notes: Optional[str]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


# ─── Endpoints ────────────────────────────────────────────

@router.get("/{epo_id}/lot-items", response_model=List[EPOLotItemResponse])
async def list_lot_items(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """List lot items for an EPO. Verifies EPO and company_id match."""
    # Verify the EPO exists and belongs to the user's company
    epo_result = await session.execute(
        select(EPO).where(
            and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
        )
    )
    epo = epo_result.scalars().first()
    if not epo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="EPO not found"
        )

    # Fetch lot items for this EPO
    query = select(EPOLotItem).where(
        and_(
            EPOLotItem.epo_id == epo_id,
            EPOLotItem.company_id == current_user.company_id,
        )
    ).order_by(EPOLotItem.created_at.asc())

    result = await session.execute(query)
    lot_items = result.scalars().all()
    return [EPOLotItemResponse.model_validate(item) for item in lot_items]


@router.post("/{epo_id}/lot-items", response_model=EPOLotItemResponse)
async def create_lot_item(
    epo_id: int,
    payload: EPOLotItemCreate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a new lot item for an EPO."""
    # Verify the EPO exists and belongs to the user's company
    epo_result = await session.execute(
        select(EPO).where(
            and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
        )
    )
    epo = epo_result.scalars().first()
    if not epo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="EPO not found"
        )

    lot_item = EPOLotItem(
        epo_id=epo_id,
        company_id=current_user.company_id,
        lot_number=payload.lot_number,
        amount=payload.amount,
        description=payload.description,
        notes=payload.notes,
    )
    session.add(lot_item)
    await session.flush()
    await session.commit()
    await session.refresh(lot_item)
    return EPOLotItemResponse.model_validate(lot_item)


@router.put("/lot-items/{item_id}", response_model=EPOLotItemResponse)
async def update_lot_item(
    item_id: int,
    payload: EPOLotItemUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update a lot item."""
    result = await session.execute(
        select(EPOLotItem).where(
            and_(
                EPOLotItem.id == item_id,
                EPOLotItem.company_id == current_user.company_id,
            )
        )
    )
    lot_item = result.scalars().first()
    if not lot_item:
        raise HTTPException(status_code=404, detail="Lot item not found")

    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(lot_item, key, value)

    await session.commit()
    await session.refresh(lot_item)
    return EPOLotItemResponse.model_validate(lot_item)


@router.delete("/lot-items/{item_id}")
async def delete_lot_item(
    item_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Delete a lot item."""
    result = await session.execute(
        select(EPOLotItem).where(
            and_(
                EPOLotItem.id == item_id,
                EPOLotItem.company_id == current_user.company_id,
            )
        )
    )
    lot_item = result.scalars().first()
    if not lot_item:
        raise HTTPException(status_code=404, detail="Lot item not found")

    await session.delete(lot_item)
    await session.commit()
    return {"deleted": True}


def _parse_lot_range(lot_string: str) -> List[str]:
    """
    Parse a lot number range or list.
    Examples:
      "1-4" -> ["1", "2", "3", "4"]
      "21, 22 and 23" -> ["21", "22", "23"]
      "1,2,3" -> ["1", "2", "3"]
      "5" -> ["5"]
    """
    lots = []

    # Handle ranges like "1-4"
    range_match = re.match(r'^(\d+)\s*-\s*(\d+)$', lot_string.strip())
    if range_match:
        start = int(range_match.group(1))
        end = int(range_match.group(2))
        lots = [str(i) for i in range(start, end + 1)]
        return lots

    # Handle comma/and-separated lists like "21, 22 and 23" or "1,2,3"
    # Replace "and" with comma for uniform splitting
    normalized = lot_string.replace(" and ", ",").replace(" or ", ",")
    parts = [p.strip() for p in normalized.split(",")]
    lots = [p for p in parts if p]

    return lots if lots else [lot_string.strip()]


@router.post("/{epo_id}/lot-items/auto-split")
async def auto_split_lot_items(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """
    Auto-generate lot items from the EPO's lot_number range.

    Parse ranges like "1-4" -> lots 1,2,3,4
    Parse lists like "21, 22 and 23" -> lots 21,22,23
    Divide EPO amount evenly across lots.
    Only works if no lot items exist yet.
    """
    # Verify the EPO exists and belongs to the user's company
    epo_result = await session.execute(
        select(EPO).where(
            and_(EPO.id == epo_id, EPO.company_id == current_user.company_id)
        )
    )
    epo = epo_result.scalars().first()
    if not epo:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="EPO not found"
        )

    # Check if lot items already exist
    existing_result = await session.execute(
        select(EPOLotItem).where(EPOLotItem.epo_id == epo_id)
    )
    existing_items = existing_result.scalars().all()
    if existing_items:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lot items already exist for this EPO",
        )

    # Parse lot_number
    if not epo.lot_number:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="EPO has no lot_number to parse",
        )

    lot_numbers = _parse_lot_range(epo.lot_number)
    if not lot_numbers:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not parse lot numbers from EPO lot_number field",
        )

    # Try to extract per-lot amounts from the raw email body
    epo_amount = float(epo.amount or 0)
    email_body = epo.raw_email_body or ""
    per_lot_amounts: dict = {}
    per_lot_descriptions: dict = {}
    pricing_source = "even_split"

    if email_body:
        # Try individual lot amounts first (most specific: "Lot 1 ... total= $1,150")
        per_lot_amounts = _extract_individual_lot_amounts(email_body)
        if per_lot_amounts:
            pricing_source = "email_individual"
            logger.info(f"EPO {epo_id}: found individual lot amounts from email: {per_lot_amounts}")
        else:
            # Try tiered pricing ("$400 per lot for lots 1-9")
            per_lot_amounts = _extract_tiered_per_lot_amounts(email_body)
            if per_lot_amounts:
                pricing_source = "email_tiered"
                logger.info(f"EPO {epo_id}: found tiered lot amounts from email: {per_lot_amounts}")

        # Try to get per-lot descriptions
        per_lot_descriptions = _extract_individual_lot_descriptions(email_body)

    # Fall back to even split if no email-based pricing found
    even_amount = epo_amount / len(lot_numbers) if lot_numbers else 0

    # Create lot items
    created_items = []
    for lot_number in lot_numbers:
        # Use email-parsed amount if available, otherwise even split
        lot_amount = per_lot_amounts.get(lot_number, even_amount)
        lot_desc = per_lot_descriptions.get(lot_number, None)

        lot_item = EPOLotItem(
            epo_id=epo_id,
            company_id=current_user.company_id,
            lot_number=lot_number,
            amount=lot_amount,
            description=lot_desc,
        )
        session.add(lot_item)
        created_items.append(lot_item)

    await session.flush()
    await session.commit()

    # Refresh all created items
    for item in created_items:
        await session.refresh(item)

    return {
        "epo_id": epo_id,
        "total_amount": epo_amount,
        "lot_count": len(lot_numbers),
        "pricing_source": pricing_source,
        "lots_created": [
            EPOLotItemResponse.model_validate(item) for item in created_items
        ],
    }
