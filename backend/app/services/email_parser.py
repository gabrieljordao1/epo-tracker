import json
import re
import base64
import logging
from typing import Dict, Any, Optional, Tuple, List
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from ..core.config import get_settings
from ..core.circuit_breaker import gemini_breaker, claude_breaker
from .sanitize import sanitize_email_body, sanitize_text_field

settings = get_settings()
logger = logging.getLogger(__name__)


class EmailParserService:
    """
    Multi-tier email parser for EPO extraction:
    1. Regex (free) - Pattern matching
    2. Gemini Flash (cheap) - Google's model
    3. Claude Haiku (reliable) - Anthropic's fallback
    """

    # Regex patterns for common EPO fields
    LOT_PATTERNS = [
        r"(?:Lot|LOT|lot)\s*#?:?\s*([A-Za-z0-9\-]+)",
        r"L-(\d+)",
        r"Lot\s+(\d+)",
    ]

    COMMUNITY_PATTERNS = [
        r"(?:Community|community):\s*([A-Za-z\s]+?)(?:\n|,|$)",
        r"(?:Subdivision|subdivision):\s*([A-Za-z\s]+?)(?:\n|,|$)",
    ]

    AMOUNT_PATTERNS = [
        r"\$\s*([0-9]+(?:[,\.][0-9]{2})?)",
        r"Amount:\s*\$?\s*([0-9]+(?:[,\.][0-9]{2})?)",
    ]

    CONFIRMATION_PATTERNS = [
        r"(?:PO|CO|Conf)\s*[-#:]\s*([A-Z0-9][\w\-]{2,19})",
        r"Confirmation\s*#?\s*:?\s*([A-Z0-9][\w\-]{2,19})",
        r"(?:PO|CO)-(\d{3,})",
    ]

    async def parse_email(
        self,
        email_subject: str,
        email_body: str,
        vendor_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Parse email through 3-tier pipeline.
        Returns standardized dict with parsed data.

        Strategy: Always prefer AI parsing for best extraction.
        Regex is only used as fallback when no AI key is available.
        """

        # Sanitize inputs first to prevent XSS/injection
        email_subject = sanitize_text_field(email_subject, max_length=500)
        email_body = sanitize_email_body(email_body)

        # Tier 1: Try Gemini Flash (preferred — handles informal emails well)
        if settings.GOOGLE_AI_API_KEY and gemini_breaker.can_execute():
            gemini_result = await self._parse_gemini(email_subject, email_body, vendor_email)
            if gemini_result and gemini_result.get("confidence_score", 0) >= 0.5:
                return gemini_result
        elif gemini_breaker.is_open:
            logger.warning("Gemini circuit breaker OPEN — skipping to next tier")

        # Tier 2: Fall back to Claude Haiku
        if settings.ANTHROPIC_API_KEY and claude_breaker.can_execute():
            haiku_result = await self._parse_haiku(email_subject, email_body, vendor_email)
            if haiku_result and haiku_result.get("confidence_score", 0) >= 0.5:
                return haiku_result
        elif claude_breaker.is_open:
            logger.warning("Claude circuit breaker OPEN — falling back to regex")

        # Tier 3: Regex fallback (free, but limited with informal emails)
        regex_result = self._parse_regex(email_subject, email_body, vendor_email)
        return regex_result

    # Standardized subject pattern: "EPO - Community - Lot # - Builder"
    SUBJECT_PATTERN = re.compile(
        r"EPO\s*[-–—]\s*(.+?)\s*[-–—]\s*(?:Lot\s*#?\s*)(.+?)\s*[-–—]\s*(.+)",
        re.IGNORECASE,
    )

    def _parse_subject_format(self, subject: str) -> Dict[str, Optional[str]]:
        """Try to parse the standardized subject: EPO - Community - Lot # - Builder"""
        match = self.SUBJECT_PATTERN.match(subject.strip())
        if match:
            return {
                "community": match.group(1).strip(),
                "lot_number": match.group(2).strip(),
                "builder_name": match.group(3).strip(),
            }
        return {}

    def _parse_regex(
        self,
        email_subject: str,
        email_body: str,
        vendor_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Tier 1: Regex-based extraction
        """
        combined_text = f"{email_subject}\n{email_body}"
        confidence_score = 0.0

        # First try standardized subject format: "EPO - Community - Lot # - Builder"
        subject_parsed = self._parse_subject_format(email_subject)

        # Try to extract vendor/builder name
        vendor_name = subject_parsed.get("builder_name") or self._extract_vendor_name(email_subject, email_body)
        vendor_email = vendor_email or self._extract_email(email_body)

        # Try to extract amount
        amount, amount_conf = self._extract_amount(combined_text)

        # Try to extract lot number (prefer subject format)
        lot_number = subject_parsed.get("lot_number")
        lot_conf = 0.95 if lot_number else 0.0
        if not lot_number:
            lot_number, lot_conf = self._extract_lot(combined_text)

        # Try to extract community (prefer subject format)
        community = subject_parsed.get("community")
        comm_conf = 0.95 if community else 0.0
        if not community:
            community, comm_conf = self._extract_community(combined_text)

        # Try to extract confirmation number
        confirmation, conf_conf = self._extract_confirmation(combined_text)

        # Boost confidence if subject was in standardized format
        if subject_parsed:
            confidence_score = 0.85  # Standardized subject = high confidence

        # Calculate overall confidence
        field_scores = {
            "vendor_name": 0.9 if vendor_name else 0.0,
            "vendor_email": 0.9 if vendor_email else 0.0,
            "amount": amount_conf,
            "lot_number": lot_conf,
            "community": comm_conf,
            "confirmation": conf_conf,
        }

        # Overall confidence is average of filled fields
        filled_fields = [s for s in field_scores.values() if s > 0]
        if not subject_parsed:
            confidence_score = sum(filled_fields) / len(filled_fields) if filled_fields else 0.1

        # Check if we have minimum viable info
        has_builder = bool(vendor_name or vendor_email)
        has_amount = amount is not None
        has_location = bool(community or lot_number)

        # High confidence if we have builder + amount + location
        if has_builder and has_amount and has_location:
            confidence_score = max(confidence_score, 0.75)

        needs_review = confidence_score < 0.7 or not (has_builder and has_amount)

        return {
            "vendor_name": vendor_name,
            "vendor_email": vendor_email,
            "community": community,
            "lot_number": lot_number,
            "description": self._extract_description(email_body),
            "amount": amount,
            "confirmation_number": confirmation,
            "confidence_score": confidence_score,
            "needs_review": needs_review,
            "parse_model": "regex",
        }

    # Known builders for fuzzy matching
    KNOWN_VENDORS = {
        "pulte": "Pulte Homes", "summit": "Summit Builders", "drb": "DRB Homes",
        "hovnanian": "K. Hovnanian", "ryan homes": "Ryan Homes", "meritage": "Meritage Homes",
        "toll brothers": "Toll Brothers", "lennar": "Lennar", "kb home": "KB Home",
        "nvr": "NVR Inc.", "mi homes": "M/I Homes", "taylor morrison": "Taylor Morrison",
        "dream finders": "Dream Finders", "stanley martin": "Stanley Martin",
    }

    # Known communities for fuzzy matching
    KNOWN_COMMUNITIES = [
        "Mallard Park", "Odell Park", "Galloway", "Cedar Hills", "Olmsted",
        "Ridgeview", "Briar Chapel", "Meadow Creek", "Stonegate", "Riverwalk",
    ]

    def _extract_vendor_name(self, subject: str, body: str) -> Optional[str]:
        """Extract vendor company name"""
        combined = f"{subject}\n{body}".lower()

        # Check known vendors in all text
        for key, name in self.KNOWN_VENDORS.items():
            if key in combined:
                return name

        # Look for signature patterns: "Thanks, Name\nCompany" or "Name, Company"
        sig_patterns = [
            r"(?:Thanks|Regards|Best|Sincerely),?\s*\n\s*([A-Z][a-z]+ [A-Z][a-z]+)\s*\n\s*([A-Z][A-Za-z\s&\.]+)",
            r"From:\s*([A-Za-z\s&\.]+?)(?:\n|<)",
        ]
        for pattern in sig_patterns:
            match = re.search(pattern, f"{subject}\n{body}")
            if match:
                name = match.group(match.lastindex).strip()
                if len(name) > 2 and len(name) < 50:
                    return name

        return None

    def _extract_email(self, body: str) -> Optional[str]:
        """Extract email address from body"""
        pattern = r"([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})"
        match = re.search(pattern, body)
        return match.group(1) if match else None

    def _extract_amount(self, text: str) -> Tuple[Optional[float], float]:
        """Extract dollar amount and confidence"""
        for pattern in self.AMOUNT_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                amount_str = match.group(1).replace(",", "").replace("$", "")
                try:
                    amount = float(amount_str)
                    if 50 <= amount <= 50000:  # Reasonable EPO range
                        return amount, 0.95
                except ValueError:
                    pass

        return None, 0.0

    def _extract_lot(self, text: str) -> Tuple[Optional[str], float]:
        """Extract lot number and confidence"""
        for pattern in self.LOT_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                lot = match.group(1).strip()
                if lot and len(lot) <= 20:
                    return lot, 0.9
        return None, 0.0

    def _extract_community(self, text: str) -> Tuple[Optional[str], float]:
        """Extract community name and confidence"""
        # First check known communities
        text_lower = text.lower()
        for comm in self.KNOWN_COMMUNITIES:
            if comm.lower() in text_lower:
                return comm, 0.95

        # Then try explicit patterns
        for pattern in self.COMMUNITY_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                community = match.group(1).strip()
                if community and len(community) <= 100:
                    return community, 0.85

        # Try "at [Place]" pattern common in construction emails
        at_pattern = r"(?:at|in|@)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})(?:\s*[.,\n]|\s+(?:Lot|lot|L-))"
        match = re.search(at_pattern, text)
        if match:
            community = match.group(1).strip()
            if len(community) > 3:
                return community, 0.7

        return None, 0.0

    def _extract_confirmation(self, text: str) -> Tuple[Optional[str], float]:
        """Extract confirmation number and confidence"""
        for pattern in self.CONFIRMATION_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                conf = match.group(1).strip()
                if conf and 3 <= len(conf) <= 20:
                    return conf, 0.9
        return None, 0.0

    def _extract_description(self, body: str) -> Optional[str]:
        """Extract work description"""
        # Look for common description patterns
        patterns = [
            r"(?:Description|Work|Services?):\s*(.+?)(?:\n|$)",
            r"(?:Extra|Additional|Change Order):\s*(.+?)(?:\n|$)",
        ]

        for pattern in patterns:
            match = re.search(pattern, body, re.IGNORECASE)
            if match:
                desc = match.group(1).strip()
                if len(desc) > 10:
                    return desc[:500]

        # If no pattern found, try to extract first 100 chars of body
        lines = body.strip().split("\n")
        for line in lines:
            if len(line) > 20:
                return line[:500]

        return None

    async def _parse_gemini(
        self,
        email_subject: str,
        email_body: str,
        vendor_email: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Tier 2: Google Gemini Flash parsing
        """
        try:
            from google import genai

            client = genai.Client(api_key=settings.GOOGLE_AI_API_KEY)

            # Build vendor context for the prompt
            vendor_hint = ""
            if vendor_email:
                vendor_hint = f"\nSender/recipient email: {vendor_email}"

            prompt = f"""You are an expert at reading construction emails from field managers at paint & drywall companies. Extract EPO (Extra Purchase Order / Extra Paint Order) data from this email.

CRITICAL RULES:
1. Emails are often INFORMAL — short texts, missing punctuation, abbreviations, typos. This is normal. Extract what you can.
2. An email may contain MULTIPLE lots. If you see "lot 2b and 2c" or "lots 5, 6, 7" — create a SEPARATE entry for each lot.
3. Community/subdivision names may be misspelled (e.g. "plott" = "Plott", "gallway" = "Galloway", "mallrd park" = "Mallard Park"). Fix obvious typos.
4. The builder name might be in the subject, body, email signature, OR derivable from the sender's email domain (e.g. "john@redcedarco.com" → "Red Cedar Co").
5. For description: use the actual work being described. If no explicit "Description:" field, summarize what work the email is about. Include the full context — don't leave it blank.
6. Dollar amounts may appear as "$350", "350.00", "350 each", or described in words.
7. If the email just says "epo for lot X at Y" with no amount, still extract what you have — set amount to null and confidence lower.

Email Subject: {email_subject}
Email Body:
{email_body}{vendor_hint}

For EACH EPO/lot found, extract:
- community: Subdivision/community name, properly capitalized (string, fix typos)
- lot_number: Lot identifier (string, e.g. "2B", "12", "A-5")
- builder_name: Builder/homebuilder company (string). Check subject, body, signature, and email domain.
- description: What work is being requested. Use the email content to describe it. NEVER leave blank — at minimum summarize the email. (string)
- amount: Dollar amount as float, or null if not mentioned
- confirmation_number: PO/confirmation number if present, or null
- confidence_score: 0-1 (be honest — 0.7+ if you got community+lot+builder, 0.5+ if missing some fields)
- needs_review: true if missing critical fields (community, lot, or amount)

Return ONLY a valid JSON array (one object per lot):
[{{"community": "Plott", "lot_number": "2B", "builder_name": "Red Cedar Co", "description": "Extra paint order for touch-ups", "amount": null, "confirmation_number": null, "confidence_score": 0.75, "needs_review": true}}]"""

            # Retry wrapper for Gemini API calls (handles transient 429/500 errors)
            @retry(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=2, max=10),
                retry=retry_if_exception_type(Exception),
                reraise=True,
            )
            def _call_gemini():
                return client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                )

            response = _call_gemini()

            response_text = response.text.strip()

            # Strip markdown code fences if present (```json ... ```)
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                # Remove first line (```json) and last line (```)
                lines = [l for l in lines if not l.strip().startswith("```")]
                response_text = "\n".join(lines).strip()

            # Handle both array and single-object responses
            parsed = json.loads(response_text)
            gemini_breaker.record_success()

            if isinstance(parsed, list):
                # Multi-EPO response — return first item, store the rest for the pipeline
                results = []
                for item in parsed:
                    item["parse_model"] = "gemini"
                    item.setdefault("confidence_score", 0.6)
                    item.setdefault("needs_review", item.get("confidence_score", 0.5) < 0.7)
                    results.append(item)
                # Return first result with _additional_epos attached
                if results:
                    result = results[0]
                    if len(results) > 1:
                        result["_additional_epos"] = results[1:]
                    return result
                return None
            else:
                # Single object response (backwards compatible)
                result = parsed
                result["parse_model"] = "gemini"
                result.setdefault("confidence_score", 0.6)
                result.setdefault("needs_review", result.get("confidence_score", 0.5) < 0.7)
                return result

        except Exception as e:
            gemini_breaker.record_failure()
            logger.error(f"Gemini parsing failed: {e}")
            return None

    async def _parse_haiku(
        self,
        email_subject: str,
        email_body: str,
        vendor_email: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Tier 3: Claude Haiku fallback parsing
        """
        try:
            import anthropic

            client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

            prompt = f"""Parse this construction EPO (Extra Paint/Work Order) email and extract structured data.

Email Subject: {email_subject}
Email Body:
{email_body}

Extract:
- vendor_name: Company name
- vendor_email: Email address
- community: Subdivision/community name
- lot_number: Lot number
- description: Work description
- amount: Dollar amount as number
- confirmation_number: PO or confirmation number
- confidence_score: Your confidence 0-1 (be conservative)
- needs_review: Boolean, true if uncertain about critical fields

Return ONLY this JSON format:
{{"vendor_name": "...", "vendor_email": "...", "community": "...", "lot_number": "...", "description": "...", "amount": 0, "confirmation_number": "...", "confidence_score": 0.8, "needs_review": false}}"""

            message = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=500,
                messages=[{"role": "user", "content": prompt}],
            )

            response_text = message.content[0].text

            # Extract JSON from response
            start_idx = response_text.find("{")
            end_idx = response_text.rfind("}") + 1

            if start_idx >= 0 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                result = json.loads(json_str)
            else:
                result = {}

            result["parse_model"] = "haiku"
            result.setdefault("confidence_score", 0.6)
            result.setdefault("needs_review", result.get("confidence_score", 0.5) < 0.7)

            claude_breaker.record_success()
            return result

        except Exception as e:
            claude_breaker.record_failure()
            logger.error(f"Haiku parsing failed: {e}")
            return {
                "vendor_name": None,
                "vendor_email": vendor_email,
                "community": None,
                "lot_number": None,
                "description": None,
                "amount": None,
                "confirmation_number": None,
                "confidence_score": 0.0,
                "needs_review": True,
                "parse_model": "haiku",
            }

    # ── Reply Intelligence ──────────────────────────────────────────────

    async def classify_reply(
        self,
        email_subject: str,
        email_body: str,
        original_epo_context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Classify an email reply's intent using Gemini.

        Returns:
            {
                "intent": "confirmation" | "denial" | "discount_request" | "question" | "unknown",
                "confirmation_number": str | None,
                "discount_details": str | None,
                "summary": str,
                "confidence": float
            }
        """
        # Try Gemini first, fall back to keyword matching
        if settings.GOOGLE_AI_API_KEY and gemini_breaker.can_execute():
            result = await self._classify_reply_gemini(email_subject, email_body, original_epo_context)
            if result and result.get("confidence", 0) >= 0.5:
                return result

        # Keyword fallback
        return self._classify_reply_keywords(email_subject, email_body)

    async def _classify_reply_gemini(
        self,
        email_subject: str,
        email_body: str,
        original_epo_context: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Use Gemini to classify reply intent."""
        try:
            from google import genai

            client = genai.Client(api_key=settings.GOOGLE_AI_API_KEY)

            context_hint = ""
            if original_epo_context:
                context_hint = f"\nOriginal EPO context: {original_epo_context}"

            prompt = f"""You are analyzing a reply email in a construction EPO (Extra Purchase Order) workflow.
A field manager sent an EPO request to a builder. The builder has replied. Classify the builder's reply intent.

INTENTS:
- "confirmation": Builder confirms the EPO, may include a PO/confirmation number. Look for: "approved", "confirmed", "PO#", "submitted", "processed", "done", "entered", "taken care of"
- "denial": Builder denies or rejects the EPO. Look for: "denied", "rejected", "cannot approve", "not authorized", "declined"
- "discount_request": Builder asks for a discount or price reduction. Look for: "discount", "reduce", "lower price", "negotiate", "too much", "credit"
- "question": Builder asks a question or needs clarification. Look for: questions, "what lot?", "which community?", "can you clarify?"
- "unknown": Cannot determine intent

Reply Email Subject: {email_subject}
Reply Email Body:
{email_body}{context_hint}

Extract:
- intent: One of the above intents (string)
- confirmation_number: PO#, confirmation#, or reference number if present (string or null). Look for patterns like "PO-12345", "CO#4567", or just a number the builder provides as confirmation.
- discount_details: If discount request, what discount are they requesting? (string or null)
- summary: One-sentence summary of what the builder is saying (string)
- confidence: 0-1 how confident you are in the classification (float)

Return ONLY valid JSON:
{{"intent": "confirmation", "confirmation_number": "PO-12345", "discount_details": null, "summary": "Builder confirmed and provided PO number", "confidence": 0.95}}"""

            @retry(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=2, max=10),
                retry=retry_if_exception_type(Exception),
                reraise=True,
            )
            def _call_gemini_classify():
                return client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=prompt,
                )

            response = _call_gemini_classify()

            response_text = response.text.strip()

            # Strip markdown code fences
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                response_text = "\n".join(lines).strip()

            result = json.loads(response_text)
            result["parse_model"] = "gemini"
            gemini_breaker.record_success()
            logger.info(f"Reply classified by Gemini: intent={result.get('intent')}, conf={result.get('confidence')}")
            return result

        except Exception as e:
            gemini_breaker.record_failure()
            logger.error(f"Gemini reply classification failed: {e}")
            return None

    def _classify_reply_keywords(self, email_subject: str, email_body: str) -> Dict[str, Any]:
        """Keyword-based fallback for reply classification."""
        combined = f"{email_subject} {email_body}".lower()

        # Check confirmation keywords
        confirm_kw = ["approved", "confirmed", "confirm", "processed", "submitted", "done", "entered", "taken care of", "completed"]
        deny_kw = ["denied", "rejected", "decline", "cannot", "not authorized", "unable to approve"]
        discount_kw = ["discount", "reduce", "lower", "negotiate", "credit", "too much", "too high"]
        question_kw = ["?", "what lot", "which community", "clarify", "can you", "please explain", "not sure"]

        # Extract confirmation number with regex
        confirmation_number = None
        for pattern in self.CONFIRMATION_PATTERNS:
            match = re.search(pattern, email_body or "")
            if match:
                confirmation_number = match.group(1)
                break

        if any(kw in combined for kw in confirm_kw) or confirmation_number:
            return {
                "intent": "confirmation",
                "confirmation_number": confirmation_number,
                "discount_details": None,
                "summary": "Builder appears to confirm the EPO",
                "confidence": 0.7 if confirmation_number else 0.5,
                "parse_model": "keywords",
            }
        elif any(kw in combined for kw in deny_kw):
            return {
                "intent": "denial",
                "confirmation_number": None,
                "discount_details": None,
                "summary": "Builder appears to deny the EPO",
                "confidence": 0.6,
                "parse_model": "keywords",
            }
        elif any(kw in combined for kw in discount_kw):
            return {
                "intent": "discount_request",
                "confirmation_number": None,
                "discount_details": "Builder requested a discount (details unclear from keywords)",
                "summary": "Builder appears to request a discount",
                "confidence": 0.5,
                "parse_model": "keywords",
            }
        elif any(kw in combined for kw in question_kw):
            return {
                "intent": "question",
                "confirmation_number": None,
                "discount_details": None,
                "summary": "Builder appears to have a question",
                "confidence": 0.5,
                "parse_model": "keywords",
            }

        return {
            "intent": "unknown",
            "confirmation_number": None,
            "discount_details": None,
            "summary": "Could not determine reply intent",
            "confidence": 0.2,
            "parse_model": "keywords",
        }

    # ── Gemini Vision — Image/Screenshot Parsing ────────────────────────

    async def parse_image_for_confirmation(
        self,
        image_bytes: bytes,
        mime_type: str = "image/png",
        epo_context: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Use Gemini Vision to extract confirmation/PO numbers from
        screenshot attachments builders send as proof of submission.

        Returns:
            {
                "confirmation_number": str | None,
                "intent": "confirmation" | "unknown",
                "details": str,
                "confidence": float
            }
        """
        if not settings.GOOGLE_AI_API_KEY:
            logger.warning("No GOOGLE_AI_API_KEY for Vision parsing")
            return None

        try:
            from google import genai
            from google.genai import types

            client = genai.Client(api_key=settings.GOOGLE_AI_API_KEY)

            context_hint = ""
            if epo_context:
                context_hint = f"\nEPO context: {epo_context}"

            prompt = f"""You are analyzing a screenshot/image attachment from a builder in a construction EPO (Extra Purchase Order) workflow.
Builders often send screenshots of their portal showing that they've submitted or approved a purchase order.

Look for:
1. PO numbers, confirmation numbers, reference numbers, order numbers
2. Status indicators: "approved", "submitted", "confirmed", "processed"
3. Any dollar amounts visible
4. Builder portal names (BuildPro, SupplyPro, etc.)
{context_hint}

Extract:
- confirmation_number: The PO/confirmation/reference number visible in the image (string or null)
- intent: "confirmation" if the image shows a confirmed/submitted PO, otherwise "unknown"
- details: Describe what you see in the image relevant to the EPO (string)
- amount: Dollar amount if visible (float or null)
- confidence: 0-1 confidence in extraction (float)

Return ONLY valid JSON:
{{"confirmation_number": "PO-12345", "intent": "confirmation", "details": "Screenshot shows BuildPro portal with submitted PO", "amount": 350.00, "confidence": 0.9}}"""

            # Build the multimodal request with image
            image_part = types.Part.from_bytes(
                data=image_bytes,
                mime_type=mime_type,
            )
            text_part = types.Part.from_text(text=prompt)

            @retry(
                stop=stop_after_attempt(3),
                wait=wait_exponential(multiplier=1, min=2, max=10),
                retry=retry_if_exception_type(Exception),
                reraise=True,
            )
            def _call_gemini_vision():
                return client.models.generate_content(
                    model="gemini-2.0-flash",
                    contents=[text_part, image_part],
                )

            response = _call_gemini_vision()

            response_text = response.text.strip()

            # Strip markdown code fences
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                lines = [l for l in lines if not l.strip().startswith("```")]
                response_text = "\n".join(lines).strip()

            result = json.loads(response_text)
            logger.info(
                f"Vision parsed image: conf#={result.get('confirmation_number')}, "
                f"intent={result.get('intent')}, confidence={result.get('confidence')}"
            )
            return result

        except Exception as e:
            logger.error(f"Gemini Vision parsing failed: {e}")
            return None
