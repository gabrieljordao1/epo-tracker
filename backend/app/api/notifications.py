"""
Notification Preferences API — manage SMS/email/push notification settings.
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, NotificationPreference

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/notifications", tags=["notifications"])


class NotificationPrefsUpdate(BaseModel):
    email_enabled: Optional[bool] = None
    sms_enabled: Optional[bool] = None
    push_enabled: Optional[bool] = None
    phone_number: Optional[str] = None
    notify_new_epo: Optional[bool] = None
    notify_status_change: Optional[bool] = None
    notify_approval_needed: Optional[bool] = None
    notify_overdue: Optional[bool] = None


@router.get("/preferences")
async def get_preferences(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get current user's notification preferences."""
    result = await session.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == current_user.id)
    )
    prefs = result.scalars().first()

    if not prefs:
        # Return defaults
        return {
            "email_enabled": True,
            "sms_enabled": False,
            "push_enabled": False,
            "phone_number": None,
            "notify_new_epo": True,
            "notify_status_change": True,
            "notify_approval_needed": True,
            "notify_overdue": True,
        }

    return {
        "email_enabled": prefs.email_enabled,
        "sms_enabled": prefs.sms_enabled,
        "push_enabled": prefs.push_enabled,
        "phone_number": prefs.phone_number,
        "notify_new_epo": prefs.notify_new_epo,
        "notify_status_change": prefs.notify_status_change,
        "notify_approval_needed": prefs.notify_approval_needed,
        "notify_overdue": prefs.notify_overdue,
    }


@router.put("/preferences")
async def update_preferences(
    update: NotificationPrefsUpdate,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update current user's notification preferences."""
    result = await session.execute(
        select(NotificationPreference).where(NotificationPreference.user_id == current_user.id)
    )
    prefs = result.scalars().first()

    if not prefs:
        prefs = NotificationPreference(
            user_id=current_user.id,
            company_id=current_user.company_id,
        )
        session.add(prefs)

    # Update only provided fields
    for field, value in update.model_dump(exclude_unset=True).items():
        if value is not None:
            setattr(prefs, field, value)

    await session.commit()
    await session.refresh(prefs)

    return {
        "email_enabled": prefs.email_enabled,
        "sms_enabled": prefs.sms_enabled,
        "push_enabled": prefs.push_enabled,
        "phone_number": prefs.phone_number,
        "notify_new_epo": prefs.notify_new_epo,
        "notify_status_change": prefs.notify_status_change,
        "notify_approval_needed": prefs.notify_approval_needed,
        "notify_overdue": prefs.notify_overdue,
        "message": "Preferences updated",
    }
