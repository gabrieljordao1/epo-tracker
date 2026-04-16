import json
import re
import logging
from typing import Dict, Any, Optional, Tuple
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from ..core.config import get_settings
from ..core.circuit_breaker import gemini_breaker, claude_breaker
from .sanitize import sanitize_email_body, sanitize_text_field

settings = get_settings()
logger = logging.getLogger(__name__)


# Obvious non-EPO subject patterns — bypass LLM entirely and reject as is_epo=false
_NON_EPO_SUBJECT_PATTERNS = [
    r"2[-\s]?step\s+verification",
    r"security\s+alert",
    r"app\s+password",
    r"new\s+sign[-\s]?in",
    r"suspicious\s+sign[-\s]?in",
    r"verify\s+your\s+account",
    r"verify\s+your\s+email",
    r"password\s+(?:reset|changed|updated)",
    r"your\s+receipt",
    r"your\s+invoice",
    r"your\s+order",
    r"account\s+(?:activity|activated|created)",
    r"^out\s+of\s+office",
    r"^automatic\s+reply",
    r"calendar\s+invite",
    r"meeting\s+(?:invite|invitation|request)",
    r"^undeliverable",
    r"^delivery\s+(?:status|failure)",
    r"mail\s+delivery\s+subsystem",
    r"unsubscribe",
    r"newsletter",
    r"^fwd:\s*(?:fwd:|re:)*\s*(?:welcome|thank\s+you)",
]
_NON_EPO_SUBJECT_RE = re.compile("|".join(_NON_EPO_SUBJECT_PATTERNS), re.IGNORECASE)


_PERSON_NAME_RE = re.compile(
    r"^[A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+(?:[-'][A-Z][a-z]+)?$"
)
_COMPANY_TOKENS = re.compile(
    r"\b(homes?|builders?|construction|development|group|company|inc|llc|corp|ltd|co\.?|communities)\b",
    re.IGNORECASE,
)
_KNOWN_BUILDER_TOKENS = {
    "pulte", "summit", "drb", "hovnanian", "ryan", "meritage", "toll",
    "lennar", "kb home", "nvr", "mi homes", "m/i", "taylor morrison",
    "dream finders", "stanley martin", "mungo", "true homes", "eastwood",
    "beazer", "dr horton", "d.r. horton", "shea", "century", "pulte homes",
    "tripointe", "tri pointe", "tri-pointe", "red cedar", "redcedar",
}

# Common email providers — NEVER a builder name
_EMAIL_PROVIDER_NAMES = {
    "hotmail", "gmail", "yahoo", "outlook", "aol", "icloud", "mail",
    "protonmail", "msn", "live", "comcast", "verizon", "att", "me",
}


def _looks_like_person_name(s: str) -> bool:
    """Returns True if the string looks like 'First Last' — i.e., a person
    rather than a builder/company name. Used to filter out Gemini's occasional
    habit of returning the email signer as builder_name.
    """
    s = (s or "").strip()
    if not s or len(s) > 60:
        return False
    # Contains explicit company tokens → it's a company
    if _COMPANY_TOKENS.search(s):
        return False
    # Known builder brand (even one word) → company
    low = s.lower()
    for tok in _KNOWN_BUILDER_TOKENS:
        if tok in low:
            return False
    # Two-word capitalized form matches person-name pattern
    return bool(_PERSON_NAME_RE.match(s))


def _is_bad_builder_name(s: str) -> bool:
    """Returns True if the builder name is clearly not a real builder:
    - Person's name (handled by _looks_like_person_name)
    - Email provider (hotmail, gmail, yahoo, etc.)
    - Empty or garbage
    """
    s = (s or "").strip()
    if not s:
        return True
    low = s.lower().replace(".com", "").replace(".net", "").strip()
    # Reject if it's just an email provider
    if low in _EMAIL_PROVIDER_NAMES:
        return True
    # Reject if matches person pattern
    if _looks_like_person_name(s):
        return True
    return False


# Canonical builder map: normalized lowercase key → display form
_BUILDER_CANONICAL = {
    "dr horton": "DR Horton",
    "drhorton": "DR Horton",
    "d.r. horton": "DR Horton",
    "d r horton": "DR Horton",
    "pulte": "Pulte",
    "pulte homes": "Pulte",
    "tripointe": "TriPointe Homes",
    "tri pointe": "TriPointe Homes",
    "tri-pointe": "TriPointe Homes",
    "tripointehomes": "TriPointe Homes",
    "red cedar": "Red Cedar",
    "redcedar": "Red Cedar",
    "red cedar co": "Red Cedar",
    "redcedarco": "Red Cedar",
    "red ceader": "Red Cedar",
    "madison simmons": "Madison Simmons Homes",
    "madison simmons homes": "Madison Simmons Homes",
    "summit": "Summit Homes",
    "mungo": "Mungo Homes",
    "true homes": "True Homes",
    "eastwood": "Eastwood Homes",
}


def _normalize_builder(s: str) -> Optional[str]:
    """Canonicalize a builder string. Returns None if input is empty/bad."""
    if not s:
        return None
    s = s.strip()
    if _is_bad_builder_name(s):
        return None
    low = s.lower().strip(" .,:;")
    low = re.sub(r"\s+", " ", low)
    if low in _BUILDER_CANONICAL:
        return _BUILDER_CANONICAL[low]
    # Try longest matching token
    for key in sorted(_BUILDER_CANONICAL.keys(), key=len, reverse=True):
        if key in low:
            return _BUILDER_CANONICAL[key]
    # Title-case fallback for unknowns
    return " ".join(w.capitalize() for w in s.split())


# Known communities — used to validate/normalize community names
_KNOWN_COMMUNITIES = {
    "olmsted", "galloway", "context", "mallard park", "plott", "sugar creek",
    "byrnes", "anderson townhomes", "anderson",
}

# Things that should NEVER be a community
_BAD_COMMUNITY_TOKENS = {
    "every level", "level", "pending", "unknown", "n/a", "none",
}


def _is_bad_community(s: str) -> bool:
    if not s:
        return True
    low = s.lower().strip()
    if low in _BAD_COMMUNITY_TOKENS:
        return True
    # Looks like a lot range, e.g. "1-20", "25,26,27"
    if re.match(r"^[\d,\s\-]+$", low):
        return True
    return False


def _normalize_community(s: str) -> Optional[str]:
    if not s:
        return None
    s = s.strip().strip(",;.")
    if _is_bad_community(s):
        return None
    low = s.lower()
    for k in _KNOWN_COMMUNITIES:
        if k == low or k in low:
            return " ".join(w.capitalize() for w in k.split())
    return " ".join(w.capitalize() for w in s.split())


# Subject parser: "[Re:] [Fwd:] Epo for lot(s) <LOTS> <community> [builder]"
_SUBJECT_RE = re.compile(
    r"^\s*(?:(?:re|fwd|fw)\s*:\s*)*"
    r"epo\s+for\s+lots?\s+(?P<lots>[0-9a-z,\s\-]+?)\s+"
    r"(?P<rest>[a-z][a-z\s]*?)\s*$",
    re.IGNORECASE,
)


def _parse_epo_subject(subject: str) -> Dict[str, Any]:
    """Parse 'Epo for lot X community builder' subject → {lot, community, builder}.
    Returns {} if it doesn't match the expected shape.
    """
    if not subject:
        return {}
    s = subject.strip()
    # Strip leading Re:/Fwd: chain
    s = re.sub(r"^\s*((re|fwd|fw)\s*:\s*)+", "", s, flags=re.IGNORECASE).strip()
    m = re.match(
        r"^epo\s+for\s+lots?\s+(?P<lots>[0-9a-zA-Z,\s\-]+?)\s+(?P<rest>[A-Za-z][A-Za-z\s]+)$",
        s,
        re.IGNORECASE,
    )
    if not m:
        return {}
    lots_str = m.group("lots").strip()
    rest = m.group("rest").strip()

    # First concrete lot from "1-20" / "25,26,27 and 28" / "21, 22 and 23" / "2b and 2c"
    first_lot = None
    tokens = re.split(r"[,\s]+|-| and ", lots_str)
    for t in tokens:
        t = t.strip()
        if t and re.match(r"^[0-9]+[a-zA-Z]?$", t):
            first_lot = t
            break
    if not first_lot and lots_str:
        # Fall back to first piece of first comma token
        first_lot = lots_str.split(",")[0].split()[0] if lots_str.split(",")[0].split() else None

    # Split "rest" into community + optional trailing builder
    rest_low = rest.lower()
    builder = None
    community = rest
    for key in sorted(_BUILDER_CANONICAL.keys(), key=len, reverse=True):
        if rest_low.endswith(" " + key) or rest_low == key:
            builder = _BUILDER_CANONICAL[key]
            community = rest[: len(rest) - len(key)].strip()
            break
    community = _normalize_community(community)

    out: Dict[str, Any] = {}
    if first_lot and not _looks_like_bad_lot(first_lot):
        out["lot_number"] = first_lot
    if community:
        out["community"] = community
    if builder:
        out["builder_name"] = builder
    return out


def _extract_total_amount(body: str) -> Optional[float]:
    """Prefer 'Total: $X' over partial per-segment amounts."""
    if not body:
        return None
    # Strip HTML
    clean = re.sub(r"<[^>]+>", " ", body)
    clean = re.sub(r"&nbsp;", " ", clean)
    clean = re.sub(r"\s+", " ", clean)
    # Look for "Total: $X,XXX.XX" pattern (case-insensitive)
    m = re.search(r"total\s*[:=]?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)", clean, re.IGNORECASE)
    if m:
        try:
            return float(m.group(1).replace(",", ""))
        except ValueError:
            pass
    return None


def _strip_reply_chain(body: str) -> str:
    """Return only the top (original) portion of an email, stripping reply quotes."""
    if not body:
        return body
    # Common reply delimiters
    patterns = [
        r"\n\s*On .{5,80} wrote:",
        r"\n\s*From:\s+[^\n]+\n",
        r"\n\s*-{3,}\s*Original Message\s*-{3,}",
        r"\n\s*_{3,}\s*\n",
        r"\n\s*>\s",
    ]
    earliest = len(body)
    for p in patterns:
        m = re.search(p, body, re.IGNORECASE)
        if m and m.start() < earliest:
            earliest = m.start()
    return body[:earliest].strip()


def _extract_original_epo_description(body: str) -> Optional[str]:
    """Find the 'Please submit an epo...' sentence from the email, skipping reply chatter."""
    if not body:
        return None
    clean = re.sub(r"<[^>]+>", " ", body)
    clean = re.sub(r"&nbsp;", " ", clean)
    clean = re.sub(r"\s+", " ", clean).strip()
    # Prefer sentence starting with "please submit" / "submit an epo"
    m = re.search(
        r"((?:please\s+)?submit\s+an?\s+epo[^.]*?(?:=\s*\$[\d,\.]+|\$[\d,\.]+|\.)\s*)",
        clean,
        re.IGNORECASE,
    )
    if m:
        return m.group(1).strip().rstrip(".,;:")
    return None


def _looks_like_bad_lot(s) -> bool:
    """True if the lot_number is clearly garbage: single letter, empty, etc."""
    if not s:
        return False
    t = str(s).strip()
    if not t:
        return False
    # Single non-digit character like "s" or "a"
    if len(t) == 1 and t.isalpha():
        return True
    # Just a comma or punctuation
    if t in (",", ".", "-"):
        return True
    return False


def _is_obvious_non_epo(subject: str, body: str) -> bool:
    """Fast reject for emails that are clearly not EPO requests.
    Catches Google/Microsoft security alerts, auto-replies, newsletters, etc.
    """
    s = (subject or "").strip()
    if not s:
        return False
    if _NON_EPO_SUBJECT_RE.search(s):
        return True
    # Google security emails often have "Google" or "noreply" sender and no lot context
    low = s.lower()
    if "google" in low and ("security" in low or "account" in low or "sign-in" in low or "sign in" in low):
        return True
    return False


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
        # $1,234.56  or  $1234.56  or  $350  or  $350.00  or  $ 1,234.56
        # Comma-thousands format first (most specific)
        r"\$\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)",
        # Plain number with $
        r"\$\s*([0-9]+(?:\.[0-9]{1,2})?)",
        # Keyword + comma-thousands: Amount: $1,234.56
        r"(?:Amount|Total|Price|Cost|Charge)[\s:]*\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)",
        # Keyword + plain number: Amount: 1234.56  or  Amount: $350
        r"(?:Amount|Total|Price|Cost|Charge)[\s:]*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)",
        # Informal phrasing: "epo of 700" / "epo for 650" / "submit an epo of $1,200"
        r"(?:EPO|epo)\s*(?:of|for)\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]{1,2})?)",
        r"(?:EPO|epo)\s*(?:of|for)\s*\$?\s*([0-9]+(?:\.[0-9]{1,2})?)",
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

        # Hard pre-filter: obvious non-EPO subjects get rejected without calling any LLM
        if _is_obvious_non_epo(email_subject, email_body):
            logger.info(f"Pre-filter: non-EPO subject '{email_subject[:60]}' — skipping")
            return {
                "is_epo": False,
                "confidence_score": 0.0,
                "needs_review": False,
                "parse_model": "prefilter",
            }

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

    # Informal subject pattern: "Epo for lot 6 byrnes madison simmons"
    # After "lot <number(s)>", remaining words split into community + builder
    INFORMAL_SUBJECT_PATTERN = re.compile(
        r"epo\s+(?:for\s+)?lot\s*#?\s*([\w]+(?:\s+and\s+[\w]+)?)\s+(.+)",
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

        # Try informal format: "Epo for lot 2b plott red cedar"
        match = self.INFORMAL_SUBJECT_PATTERN.match(subject.strip())
        if match:
            lot_number = match.group(1).strip()
            remainder = match.group(2).strip()
            # Try to split remainder into community + builder using known communities
            remainder_lower = remainder.lower()
            for comm in self.KNOWN_COMMUNITIES:
                if remainder_lower.startswith(comm.lower()):
                    community = comm
                    builder = remainder[len(comm):].strip()
                    return {
                        "community": community,
                        "lot_number": lot_number,
                        "builder_name": builder if builder else None,
                    }
            # If no known community matched, first word is community, rest is builder
            parts = remainder.split(None, 1)
            if len(parts) >= 2:
                return {
                    "community": parts[0].title(),
                    "lot_number": lot_number,
                    "builder_name": parts[1].strip().title(),
                }
            elif len(parts) == 1:
                return {
                    "community": parts[0].title(),
                    "lot_number": lot_number,
                    "builder_name": None,
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
            "description": self._extract_description(email_body) or email_subject,
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
        "Plott", "Byrnes", "Hasentree", "Wendell Falls", "5401 North",
        "Holding Village", "Chatham Park", "Traditions", "Magnolia Green",
        "12 Oaks", "Regency at White Oak Creek", "Jordan Pointe",
        "Sugar Creek", "Westfall", "Avendale", "The Pines",
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
                    if 1 <= amount <= 500000:  # Widened range for all EPO sizes
                        return amount, 0.95
                    else:
                        logger.warning(
                            f"Amount ${amount:,.2f} found but outside range "
                            f"$1-$500K, discarding"
                        )
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

            prompt = f"""You read emails for a paint & drywall subcontractor's field manager and extract Extra Purchase Order (EPO) requests. EPOs are requests for extra paint/drywall work on a specific lot at a builder's community.

STEP 1 — CLASSIFY: First, decide if this email is actually an EPO request from a field manager to submit/approve extra work. Return is_epo=false for ALL of these (and return an empty array []):
- Google/Gmail/Microsoft security alerts ("2-Step Verification", "App password created", "New sign-in", "Security alert")
- Newsletters, marketing, receipts, invoices from non-construction companies
- Calendar invites, meeting notes, out-of-office replies
- Generic replies without any lot/community/amount context ("ok thanks", "got it", "sounds good")
- Personal emails (family, scheduling, non-work)
- Spam or phishing
An EPO email normally contains SOME of: the word "EPO" or "extra paint" or "extra work", a lot number, a community/subdivision, a dollar amount, or describes paint/drywall work to perform.

STEP 2 — IF it IS an EPO, extract one object per lot. Multi-lot rule: "lot 2b and 2c" or "lots 5, 6, 7" → one entry per lot, each with the SAME description and amount split evenly if total given. "$700 for lots 2b and 2c" = $350 each. "epo of 400 per lot for lots 1-9" = nine entries, $400 each.

EXTRACTION RULES:
- community: Subdivision name, properly capitalized. Fix obvious typos ("plott"→"Plott", "gallway"→"Galloway", "mallrd park"→"Mallard Park"). NEVER use garbage like "View", "1-20", "21,", words lifted from mid-sentence. If you cannot identify a real community, set null.
- lot_number: Just the lot identifier like "12", "2B", "A-5". NEVER a single letter like "s" or "a" pulled from mid-word. If you cannot find a clear lot, set null.
- builder_name: The HOMEBUILDER COMPANY (Pulte, Summit, DRB, Hovnanian, Ryan Homes, Meritage, Toll Brothers, Lennar, KB Home, NVR, M/I Homes, Taylor Morrison, Dream Finders, Stanley Martin, Mungo, True Homes, Eastwood, etc.). CRITICAL RULES:
  * NEVER return a person's name (first+last like "Gabriel Jordao", "Sue Bennett", "John Smith"). Builders are COMPANIES, not people.
  * NEVER return the paint/drywall subcontractor's name — they are the sender, not the builder.
  * If the only thing you can see is a person's signature with no company, set builder_name to null.
  * If you see "Pulte", "DRB Homes", etc. in the email domain or body, use that.
  * If you can't identify a real homebuilder company, set null — do NOT guess a person's name.
- description: ONE SHORT SENTENCE describing the actual work. Strip "please submit an epo of $X to" prefixes. Good: "Patch and paint holes in master bedroom after cabinet install". Bad: "Please submit an epo of 350 to patch and". NEVER truncate mid-word — always end at a sentence boundary. If the email literally gives no work description, write "Extra paint/drywall work" and set needs_review=true.
- amount: Dollar amount as float. Patterns: "$350", "350", "350.00", "350 each", "epo of 700", "$1,200", "12 hundred". If a total is given for multiple lots, divide. If truly no amount in the text, set null.
- confirmation_number: PO/confirmation number if present, else null.
- confidence_score: 0.85+ if all of community+lot+builder+amount are clean; 0.7+ if one is missing; 0.5+ if two are missing; below 0.5 if it's barely recognizable as an EPO.
- needs_review: true if ANY of community/lot/amount is null, OR confidence < 0.8.

Email Subject: {email_subject}
Email Body:
{email_body}{vendor_hint}

OUTPUT FORMAT (JSON only, no markdown, no commentary):
{{"is_epo": true|false, "epos": [ {{...entry per lot...}} ]}}

If is_epo=false, return {{"is_epo": false, "epos": []}}.

Example (valid EPO):
{{"is_epo": true, "epos": [{{"community": "Plott", "lot_number": "2B", "builder_name": "Pulte", "description": "Patch and paint touch-ups after cabinet install in master bath", "amount": 350.0, "confirmation_number": null, "confidence_score": 0.9, "needs_review": false}}]}}

Example (Google security alert):
{{"is_epo": false, "epos": []}}"""

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
                lines = [line for line in lines if not line.strip().startswith("```")]
                response_text = "\n".join(lines).strip()

            # Handle new envelope {is_epo, epos:[...]}, legacy array, or single object
            parsed = json.loads(response_text)
            gemini_breaker.record_success()

            # Unwrap envelope
            if isinstance(parsed, dict) and "is_epo" in parsed:
                if not parsed.get("is_epo"):
                    # Gate: not an EPO email — return signal to skip
                    logger.info(f"Gemini classifier: is_epo=false for subject '{email_subject[:80]}'")
                    return {
                        "is_epo": False,
                        "confidence_score": 0.0,
                        "needs_review": False,
                        "parse_model": "gemini",
                    }
                items = parsed.get("epos") or []
            elif isinstance(parsed, list):
                items = parsed
            else:
                items = [parsed]

            results = []
            for item in items:
                if not isinstance(item, dict):
                    continue
                item["parse_model"] = "gemini"
                item["is_epo"] = True
                item.setdefault("confidence_score", 0.6)
                item.setdefault("needs_review", item.get("confidence_score", 0.5) < 0.8)
                # Safety net: drop person-name builder_names — Gemini sometimes
                # returns "John Smith" when only a signature exists.
                b = item.get("builder_name")
                if b and _looks_like_person_name(b):
                    logger.info(f"Dropping person-name builder '{b}' — not a company")
                    item["builder_name"] = None
                results.append(item)

            if results:
                result = results[0]
                if len(results) > 1:
                    result["_additional_epos"] = results[1:]
                return result
            return None

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
                lines = [line for line in lines if not line.strip().startswith("```")]
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
            logger.error(
                "GOOGLE_AI_API_KEY not configured — cannot parse image attachments. "
                "Set this in Railway environment variables."
            )
            return None

        logger.info(
            f"Starting Gemini Vision parse: {len(image_bytes)} bytes, "
            f"mime={mime_type}"
        )

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

            import asyncio
            response = await asyncio.to_thread(_call_gemini_vision)

            response_text = response.text.strip()

            # Strip markdown code fences
            if response_text.startswith("```"):
                lines = response_text.split("\n")
                lines = [line for line in lines if not line.strip().startswith("```")]
                response_text = "\n".join(lines).strip()

            result = json.loads(response_text)
            logger.info(
                f"Vision parsed image: conf#={result.get('confirmation_number')}, "
                f"intent={result.get('intent')}, confidence={result.get('confidence')}"
            )
            return result

        except json.JSONDecodeError as e:
            raw = locals().get("response_text", "N/A")
            logger.error(
                f"Gemini Vision returned invalid JSON: {e}. "
                f"Raw response: {str(raw)[:500]}"
            )
            return None
        except Exception as e:
            logger.error(f"Gemini Vision parsing failed: {e}", exc_info=True)
            return None
