"""
AI Agent Pipeline for email processing.
Orchestrates parsing, EPO creation, vendor confirmation, and follow-up logic.
"""

import logging
import secrets
import re
from typing import Dict, Any, Optional, List
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
        builder_name: Optional[str] = None,
        builder_email: Optional[str] = None,
        submitter_email: Optional[str] = None,
        submitted_by_id: Optional[int] = None,
        gmail_thread_id: Optional[str] = None,
        gmail_message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Main pipeline: parse email → create EPO → send confirmation request.

        New workflow:
        - builder_name/builder_email: The builder company this EPO is for (from TO recipients)
        - submitter_email: The field manager who sent the email (from FROM field)
        - submitted_by_id: The User.id of the submitter (matched from email)

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
            # Use builder_name from webhook (derived from TO email domain) if provided,
            # then try parser's builder_name or vendor_name, finally fallback
            vendor_name = (
                builder_name
                or parsed.get("builder_name")
                or parsed.get("vendor_name")
                or "Unknown Builder"
            )
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
                created_by_id=submitted_by_id,
                vendor_name=vendor_name,  # Stores builder name
                vendor_email=builder_email or vendor_email,  # Stores builder email
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
                gmail_thread_id=gmail_thread_id,
                gmail_message_id=gmail_message_id,
            )

            session.add(epo)
            await session.flush()  # Get the ID
            epo_id = epo.id

            logger.info(f"Created EPO #{epo_id} from email, confidence={confidence_score:.2f}")

            result["epo_id"] = epo_id
            result["vendor_token"] = vendor_token
            result["created"] = True
            result["needs_review"] = needs_review

            # Step 3b: Create additional EPOs if multi-lot email
            additional_epos = parsed.get("_additional_epos", [])
            additional_ids = []
            for extra in additional_epos:
                try:
                    extra_token = secrets.token_urlsafe(32)
                    extra_epo = EPO(
                        company_id=company_id,
                        email_connection_id=email_connection_id,
                        created_by_id=submitted_by_id,
                        vendor_name=(
                            builder_name
                            or extra.get("builder_name")
                            or extra.get("vendor_name")
                            or vendor_name
                        ),
                        vendor_email=builder_email or vendor_email,
                        community=extra.get("community") or community,
                        lot_number=extra.get("lot_number"),
                        description=extra.get("description"),
                        amount=extra.get("amount"),
                        confirmation_number=extra.get("confirmation_number"),
                        status=EPOStatus.PENDING,
                        confidence_score=extra.get("confidence_score", confidence_score),
                        parse_model=parse_model,
                        raw_email_subject=email_subject,
                        raw_email_body=email_body,
                        synced_from_email=True,
                        vendor_token=extra_token,
                        needs_review=extra.get("confidence_score", confidence_score) < 0.8,
                    )
                    session.add(extra_epo)
                    await session.flush()
                    additional_ids.append(extra_epo.id)
                    logger.info(
                        f"Created additional EPO #{extra_epo.id} "
                        f"(lot={extra.get('lot_number')}, amount={extra.get('amount')})"
                    )
                except Exception as e:
                    logger.error(f"Error creating additional EPO: {e}")

            if additional_ids:
                result["additional_epo_ids"] = additional_ids
                logger.info(f"Multi-lot email: created {1 + len(additional_ids)} EPOs total")

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

    async def process_reply_email(
        self,
        session: AsyncSession,
        epo: "EPO",
        email_subject: str,
        email_body: str,
        image_attachments: Optional[list] = None,
        gmail_api: Optional[Any] = None,
        access_token: Optional[str] = None,
        refresh_token: Optional[str] = None,
        token_expires_at: Optional[Any] = None,
        message_id: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Process a reply email matched to an existing EPO.
        Uses Gemini to classify intent and extract confirmation numbers.
        If image attachments are present, uses Gemini Vision to parse them.

        Flow:
        1. Classify reply intent (confirmation, denial, discount, question)
        2. If images attached, parse with Gemini Vision for PO screenshots
        3. Update EPO status based on combined intelligence
        """
        result = {
            "success": False,
            "epo_id": epo.id,
            "intent": None,
            "new_status": None,
            "confirmation_number": None,
            "changes_made": False,
            "image_parsed": False,
            "error": None,
        }

        try:
            # Build context from the original EPO for smarter classification
            epo_context = (
                f"Builder: {epo.vendor_name}, Community: {epo.community}, "
                f"Lot: {epo.lot_number}, Amount: ${epo.amount or 'N/A'}, "
                f"Description: {epo.description or 'N/A'}"
            )

            # Step 1: Classify the reply text
            classification = await self.parser.classify_reply(
                email_subject=email_subject,
                email_body=email_body,
                original_epo_context=epo_context,
            )

            intent = classification.get("intent", "unknown")
            confirmation_number = classification.get("confirmation_number")
            result["intent"] = intent

            logger.info(
                f"Reply for EPO #{epo.id}: intent={intent}, "
                f"conf#={confirmation_number}, "
                f"confidence={classification.get('confidence', 0):.2f}"
            )

            # Step 2: Parse image attachments with Gemini Vision
            vision_confirmation = None
            if image_attachments and gmail_api and access_token and message_id:
                for attachment in image_attachments[:3]:  # Limit to 3 images
                    try:
                        image_bytes = await gmail_api.get_attachment(
                            access_token=access_token,
                            refresh_token=refresh_token,
                            token_expires_at=token_expires_at,
                            message_id=message_id,
                            attachment_id=attachment["attachmentId"],
                        )
                        if image_bytes:
                            vision_result = await self.parser.parse_image_for_confirmation(
                                image_bytes=image_bytes,
                                mime_type=attachment.get("mimeType", "image/png"),
                                epo_context=epo_context,
                            )
                            if vision_result:
                                result["image_parsed"] = True
                                if vision_result.get("confirmation_number"):
                                    vision_confirmation = vision_result["confirmation_number"]
                                    logger.info(
                                        f"Vision extracted conf#={vision_confirmation} "
                                        f"from {attachment.get('filename')}"
                                    )
                                # If vision says it's a confirmation, upgrade intent
                                if vision_result.get("intent") == "confirmation" and intent != "confirmation":
                                    if vision_result.get("confidence", 0) >= 0.7:
                                        intent = "confirmation"
                                        result["intent"] = intent
                                        logger.info(
                                            f"Vision upgraded intent to 'confirmation' for EPO #{epo.id}"
                                        )
                    except Exception as e:
                        logger.error(f"Error parsing attachment {attachment.get('filename')}: {e}")

            # Use the best confirmation number available
            final_confirmation = vision_confirmation or confirmation_number
            result["confirmation_number"] = final_confirmation

            # Step 3: Update EPO based on intent
            changes_made = False

            if intent == "confirmation":
                epo.status = EPOStatus.CONFIRMED
                if final_confirmation:
                    epo.confirmation_number = final_confirmation
                changes_made = True
                result["new_status"] = "confirmed"
                logger.info(f"EPO #{epo.id} CONFIRMED, conf#={final_confirmation}")

            elif intent == "denial":
                epo.status = EPOStatus.DENIED
                changes_made = True
                result["new_status"] = "denied"
                logger.info(f"EPO #{epo.id} DENIED by builder")

            elif intent == "discount_request":
                epo.status = EPOStatus.DISCOUNT
                epo.needs_review = True
                changes_made = True
                result["new_status"] = "discount"
                logger.info(
                    f"EPO #{epo.id} discount requested: "
                    f"{classification.get('discount_details', 'no details')}"
                )

            elif intent == "question":
                # Don't change status, but flag for review
                epo.needs_review = True
                changes_made = True
                logger.info(f"EPO #{epo.id} flagged — builder has a question")

            if changes_made:
                result["changes_made"] = True
                await session.commit()

            result["success"] = True
            return result

        except Exception as e:
            logger.error(f"Reply processing error for EPO #{epo.id}: {e}", exc_info=True)
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
