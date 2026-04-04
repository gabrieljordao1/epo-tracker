import json
import re
from typing import Dict, Any, Optional, Tuple
from ..core.config import get_settings
from .sanitize import sanitize_email_body, sanitize_text_field

settings = get_settings()


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
        """

        # Sanitize inputs first to prevent XSS/injection
        email_subject = sanitize_text_field(email_subject, max_length=500)
        email_body = sanitize_email_body(email_body)

        # Tier 1: Try regex first (free)
        regex_result = self._parse_regex(email_subject, email_body, vendor_email)
        if regex_result.get("confidence_score", 0) >= 0.7:
            return regex_result

        # Tier 2: Try Gemini Flash if available
        if settings.GOOGLE_AI_API_KEY:
            gemini_result = await self._parse_gemini(email_subject, email_body, vendor_email)
            if gemini_result and gemini_result.get("confidence_score", 0) >= 0.6:
                return gemini_result

        # Tier 3: Fall back to Claude Haiku
        if settings.ANTHROPIC_API_KEY:
            haiku_result = await self._parse_haiku(email_subject, email_body, vendor_email)
            return haiku_result

        # If all fail, return low-confidence regex result
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

            prompt = f"""Parse this construction EPO (Extra Purchase Order) email and extract structured data.

The subject line typically follows this format: "EPO - Community - Lot # - Builder"
Example: "EPO - Galloway - Lot 12 - Meritage Homes"

The builder name may also be in the subject. The email body contains the work description, amount, and other details.

Email Subject: {email_subject}
Email Body:
{email_body}

Extract these fields:
- community: Subdivision/community name from subject or body (string)
- lot_number: Lot number from subject or body (string)
- builder_name: Builder/homebuilder company name from subject (string, e.g. "Meritage Homes", "Pulte", "DR Horton")
- description: Work description (string)
- amount: Dollar amount as number (float)
- confirmation_number: PO or confirmation number if present (string)
- confidence_score: Your confidence 0-1
- needs_review: Boolean, true if uncertain about critical fields

Return ONLY valid JSON:
{{"community": "...", "lot_number": "...", "builder_name": "...", "description": "...", "amount": 0, "confirmation_number": "...", "confidence_score": 0.8, "needs_review": false}}"""

            response = client.models.generate_content(
                model="gemini-2.0-flash",
                contents=prompt,
            )

            response_text = response.text
            result = json.loads(response_text)

            result["parse_model"] = "gemini"
            result.setdefault("confidence_score", 0.6)
            result.setdefault("needs_review", result.get("confidence_score", 0.5) < 0.7)

            return result

        except Exception as e:
            print(f"Gemini parsing failed: {e}")
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

            return result

        except Exception as e:
            print(f"Haiku parsing failed: {e}")
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
