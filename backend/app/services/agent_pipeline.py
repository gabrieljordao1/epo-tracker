"""
AI Agent Pipeline for email processing.
Orchestrates parsing, EPO creation, vendor confirmation, and follow-up logic.
"""

import logging
import secrets
import re
from typing import Dict, Any, Optional
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.config import get_settings
from ..models.models import EPO, EmailConnection, Company, EPOStatus
from .email_parser import EmailParserService
from .email_sender import EmailSenderService

logger = logging.getLogger(__name__)
settings = get_settings()


class AgentPipelineService:
    """Orchestrates email processing through parsing, creation, and confirmation."""

    def __init__(
        self,
        parser: Optional[EmailParserService] = None,
        sender: Optional[EmailSenderService] = None,
    ):
        self.parser = parser or EmailParserService()
        self.sender = sender or EmailSenderService(
            api_key=settings.RESEND_API_KEY,
            from_address=settings.EMAIL_FROM_ADDRESS,
            from_name=settings.EMAIL_FROM_NAME,
        )

    async def process_new_email(
        self,
        session: AsyncSession,
        email_subject: str,
        email_body: str,
        vendor_email: str,
        company_id: int,
        email_connection_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Main pipeline: parse email → create EPO → send confirmation request.

        Returns:
            Dict with epo_id, vendor_token, confidence_score, needs_review, etc.
        """
        result = {
            "success": False,
            "epo_id": None,
            "vendor_token": None,
            "confidence_score": 0.0,
            "parse_model": None,
            "needs_review": False,
            "confirmation_email_sent": False,
            "created": False,
            "error": None,
        }

        try:
            # Step 1: Parse the email
            logger.info(f"Parsing email from {vendor_email} for company {company_id}")
            parsed = await self.parser.parse_email(
                email_subject=email_subject,
                email_body=email_body,
                vendor_email=vendor_email,
            )

            if not parsed:
                result["error"] = "Failed to parse email"
                return result

            # Extract parsed data
            vendor_name = parsed.get("vendor_name", "Unknown Vendor")
            community = parsed.get("community")
            lot_number = parsed.get("lot_number")
            description = parsed.get("description")
            amount = parsed.get("amount")
            confirmation_number = parsed.get("confirmation_number")
            confidence_score = parsed.get("confidence_score", 0.0)
            parse_model = parsed.get("parse_model", "unknown")

            result["confidence_score"] = confidence_score
            result["parse_model"] = parse_model

            # Step 2: Determine if we should auto-create
            # Only auto-create if confidence is above threshold
            if confidence_score < 0.6:
                result["needs_review"] = True
                logger.info(f"Low confidence ({confidence_score:.2f}) - will need manual review")
                return result

            # Step 3: Create EPO record
            vendor_token = secrets.token_urlsafe(32)
            needs_review = confidence_score < 0.8

            epo = EPO(
                company_id=company_id,
                email_connection_id=email_connection_id,
                vendor_name=vendor_name,
                vendor_email=vendor_email,
                community=community,
                lot_number=lot_number,
                description=description,
                amount=amount,
                confirmation_number=confirmation_number,
                status=EPOStatus.PENDING,
                confidence_score=confidence_score,
                parse_model=parse_model,
                raw_email_subject=email_subject,
                raw_email_body=email_body,
                synced_from_email=True,
                vendor_token=vendor_token,
                needs_review=needs_review,
            )

            session.add(epo)
            await session.flush()  # Get the ID
            epo_id = epo.id

            logger.info(f"Created EPO #{epo_id} from email, confidence={confidence_score:.2f}")

            result["epo_id"] = epo_id
            result["vendor_token"] = vendor_token
            result["created"] = True
            result["needs_review"] = needs_review

            # Step 4: Send confirmation request email
            try:
                company_result = await session.execute(
                    select(Company).where(Company.id == company_id)
                )
                company = company_result.scalars().first()
                company_name = company.name if company else "EPO Tracker"

                vendor_portal_url = f"{settings.APP_URL}/vendor/{vendor_token}"

                send_result = await self.sender.send_followup(
                    to_email=vendor_email,
                    vendor_name=vendor_name,
                    epo_description=description or "Extra work",
                    epo_amount=amount or 0.0,
                    community=community or "N/A",
                    lot_number=lot_number or "N/A",
                    days_open=0,
                    company_name=company_name,
                    vendor_portal_url=vendor_portal_url,
                )

                if send_result.get("success"):
                    result["confirmation_email_sent"] = True
                    logger.info(f"Confirmation email sent to {vendor_email}")
                else:
                    logger.warning(f"Failed to send confirmation email: {send_result.get('error')}")

            except Exception as e:
                logger.error(f"Error sending confirmation email: {e}")
                # Don't fail the whole pipeline if email sending fails

            result["success"] = True
            await session.commit()
            return result

        except Exception as e:
            logger.error(f"Pipeline error: {e}", exc_info=True)
            result["error"] = str(e)
            await session.rollback()
            return result

    async def process_vendor_reply(
        self,
        session: AsyncSession,
        email_subject: str,
        email_body: str,
        vendor_email: str,
        company_id: int,
    ) -> Dict[str, Any]:
        """
        Detect vendor confirmations/disputes from replies.
        Looks for confirmation numbers and confirmation keywords.

        Returns:
            Dict with epo_id, new_status, changes_made, etc.
        """
        result = {
            "success": False,
            "epo_id": None,
            "new_status": None,
            "changes_made": False,
            "error": None,
        }

        try:
            # Find matching EPO
            epo_query = select(EPO).where(
                (EPO.vendor_email == vendor_email)
                & (EPO.company_id == company_id)
                & (EPO.status == EPOStatus.PENDING)
            )
            epo_result = await session.execute(epo_query)
            epo = epo_result.scalars().first()

            if not epo:
                result["error"] = "No matching pending EPO found"
                return result

            result["epo_id"] = epo.id

            # Check for confirmation keywords
            body_lower = (email_body or "").lower()
            subject_lower = (email_subject or "").lower()
            combined_lower = f"{subject_lower} {body_lower}"

            confirmation_keywords = [
                "approved",
                "confirmed",
                "confirm",
                "approval granted",
                "ok",
                "accepted",
            ]

            is_confirmed = any(kw in combined_lower for kw in confirmation_keywords)

            # Extract confirmation number if present
            confirmation_patterns = [
                r"(?:PO|CO|Conf)\s*[-#:]\s*([A-Z0-9][\w\-]{2,19})",
                r"Confirmation\s*#?\s*:?\s*([A-Z0-9][\w\-]{2,19})",
                r"(?:PO|CO)-(\d{3,})",
            ]

            confirmation_number = None
            for pattern in confirmation_patterns:
                match = re.search(pattern, email_body or "")
                if match:
                    confirmation_number = match.group(1)
                    break

            # Check for dispute/denial keywords
            dispute_keywords = [
                "deny",
                "denied",
                "reject",
                "rejected",
                "cannot",
                "unable",
                "no",
            ]
            is_disputed = any(kw in combined_lower for kw in dispute_keywords)

            # Update EPO status
            changes_made = False
            if is_confirmed:
                epo.status = EPOStatus.CONFIRMED
                epo.confirmation_number = confirmation_number or epo.confirmation_number
                changes_made = True
                result["new_status"] = EPOStatus.CONFIRMED

                logger.info(
                    f"EPO #{epo.id} confirmed by vendor, conf#={confirmation_number}"
                )

            elif is_disputed:
                epo.status = EPOStatus.DENIED
                changes_made = True
                result["new_status"] = EPOStatus.DENIED

                logger.info(f"EPO #{epo.id} disputed by vendor")

            if changes_made:
                result["changes_made"] = True
                result["success"] = True
                await session.commit()
            else:
                result["success"] = True

            return result

        except Exception as e:
            logger.error(f"Vendor reply processing error: {e}", exc_info=True)
            result["error"] = str(e)
            await session.rollback()
            return result

    async def run_followup_check(
        self,
        session: AsyncSession,
        company_id: int,
    ) -> Dict[str, Any]:
        """
        Smart follow-up logic: sends follow-ups to pending EPOs based on age.

        Rules:
        - First follow-up after 3 days
        - Second follow-up after 5 days
        - Third follow-up after 7 days

        Returns:
            Dict with followups_sent, epos_checked, etc.
        """
        result = {
            "success": False,
            "epos_checked": 0,
            "followups_sent": 0,
            "errors": [],
        }

        try:
            # Get all pending EPOs for this company
            epo_query = select(EPO).where(
                (EPO.company_id == company_id) & (EPO.status == EPOStatus.PENDING)
            )
            epo_result = await session.execute(epo_query)
            epos = epo_result.scalars().all()

            result["epos_checked"] = len(epos)

            # Get company info
            company_result = await session.execute(
                select(Company).where(Company.id == company_id)
            )
            company = company_result.scalars().first()
            company_name = company.name if company else "EPO Tracker"

            # Process each EPO
            for epo in epos:
                try:
                    # Calculate days open
                    if not epo.created_at:
                        continue

                    days_open = (datetime.utcnow() - epo.created_at.replace(tzinfo=None)).days

                    # Determine if we should send a follow-up
                    followup_days = settings.AGENT_FOLLOWUP_DAYS  # [3, 5, 7]

                    # Count existing follow-ups
                    from .email_sender import EmailSenderService  # Already imported above

                    # This would require additional DB access
                    # For now, simple heuristic: send if days_open matches followup_days
                    if days_open in followup_days:
                        # Send follow-up
                        vendor_portal_url = f"{settings.APP_URL}/vendor/{epo.vendor_token}"

                        send_result = await self.sender.send_followup(
                            to_email=epo.vendor_email,
                            vendor_name=epo.vendor_name,
                            epo_description=epo.description or "Extra work",
                            epo_amount=epo.amount or 0.0,
                            community=epo.community or "N/A",
                            lot_number=epo.lot_number or "N/A",
                            days_open=days_open,
                            company_name=company_name,
                            vendor_portal_url=vendor_portal_url,
                        )

                        if send_result.get("success"):
                            result["followups_sent"] += 1
                            logger.info(
                                f"Follow-up sent for EPO #{epo.id} "
                                f"({days_open} days old)"
                            )
                        else:
                            result["errors"].append(
                                f"EPO #{epo.id}: {send_result.get('error')}"
                            )

                except Exception as e:
                    logger.error(f"Error processing EPO #{epo.id}: {e}")
                    result["errors"].append(f"EPO #{epo.id}: {str(e)}")

            result["success"] = True
            return result

        except Exception as e:
            logger.error(f"Follow-up check error: {e}", exc_info=True)
            result["errors"].append(str(e))
            return result
