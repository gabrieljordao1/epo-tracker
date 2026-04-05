"""
EPO Attachments API — upload photos/files to EPOs via Supabase Storage.
"""
import logging
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from ..core.config import get_settings
from ..core.database import get_db
from ..core.auth import get_current_user
from ..models.models import User, EPO, EPOAttachment

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/attachments", tags=["attachments"])

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp", "image/heic",
    "application/pdf",
}


@router.post("/epo/{epo_id}/upload")
async def upload_attachment(
    epo_id: int,
    file: UploadFile = File(...),
    description: Optional[str] = Form(None),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Upload a photo/file attachment to an EPO."""
    # Verify EPO belongs to user's company
    result = await session.execute(
        select(EPO).where(EPO.id == epo_id, EPO.company_id == current_user.company_id)
    )
    epo = result.scalars().first()
    if not epo:
        raise HTTPException(status_code=404, detail="EPO not found")

    # Validate file
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"File type not allowed. Allowed: {', '.join(ALLOWED_MIME_TYPES)}",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File too large. Max 10 MB.")

    # Generate unique filename
    ext = file.filename.rsplit(".", 1)[-1] if "." in (file.filename or "") else "bin"
    storage_key = f"epo-attachments/{current_user.company_id}/{epo_id}/{uuid.uuid4().hex}.{ext}"

    # Upload to Supabase Storage if configured, otherwise store locally
    file_url = ""
    if settings.SUPABASE_URL and settings.SUPABASE_SERVICE_KEY:
        try:
            import httpx
            upload_url = f"{settings.SUPABASE_URL}/storage/v1/object/epo-attachments/{storage_key}"
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    upload_url,
                    headers={
                        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
                        "Content-Type": file.content_type or "application/octet-stream",
                    },
                    content=contents,
                )
                if resp.status_code in (200, 201):
                    file_url = f"{settings.SUPABASE_URL}/storage/v1/object/public/epo-attachments/{storage_key}"
                else:
                    logger.error(f"Supabase upload failed: {resp.status_code} {resp.text}")
                    raise HTTPException(status_code=500, detail="File upload failed")
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Supabase upload error: {e}")
            raise HTTPException(status_code=500, detail="File upload failed")
    else:
        # Fallback: store URL placeholder (for development)
        file_url = f"/uploads/{storage_key}"
        logger.warning("Supabase not configured — attachment URL is a placeholder")

    # Create attachment record
    attachment = EPOAttachment(
        epo_id=epo_id,
        company_id=current_user.company_id,
        uploaded_by_id=current_user.id,
        filename=file.filename or "attachment",
        file_url=file_url,
        file_size=len(contents),
        mime_type=file.content_type,
        description=description,
    )
    session.add(attachment)
    await session.commit()
    await session.refresh(attachment)

    return {
        "id": attachment.id,
        "epo_id": epo_id,
        "filename": attachment.filename,
        "file_url": attachment.file_url,
        "file_size": attachment.file_size,
        "mime_type": attachment.mime_type,
        "description": attachment.description,
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
    }


@router.get("/epo/{epo_id}")
async def list_attachments(
    epo_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """List all attachments for an EPO."""
    # Verify EPO belongs to user's company
    result = await session.execute(
        select(EPO).where(EPO.id == epo_id, EPO.company_id == current_user.company_id)
    )
    epo = result.scalars().first()
    if not epo:
        raise HTTPException(status_code=404, detail="EPO not found")

    result = await session.execute(
        select(EPOAttachment)
        .where(EPOAttachment.epo_id == epo_id)
        .order_by(EPOAttachment.created_at.desc())
    )
    attachments = result.scalars().all()

    return {
        "attachments": [
            {
                "id": a.id,
                "filename": a.filename,
                "file_url": a.file_url,
                "file_size": a.file_size,
                "mime_type": a.mime_type,
                "description": a.description,
                "created_at": a.created_at.isoformat() if a.created_at else None,
            }
            for a in attachments
        ],
        "total": len(attachments),
    }


@router.delete("/{attachment_id}")
async def delete_attachment(
    attachment_id: int,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Delete an attachment."""
    result = await session.execute(
        select(EPOAttachment).where(
            EPOAttachment.id == attachment_id,
            EPOAttachment.company_id == current_user.company_id,
        )
    )
    attachment = result.scalars().first()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    await session.delete(attachment)
    await session.commit()
    return {"success": True, "message": "Attachment deleted"}
