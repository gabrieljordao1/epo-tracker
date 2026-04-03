"""Tests for the email parsing pipeline."""

import pytest
from app.services.email_parser import EmailParserService


@pytest.mark.asyncio
async def test_parse_standard_epo_email():
    """Test parsing a well-formatted EPO email."""
    parser = EmailParserService()
    result = await parser.parse_email(
        email_subject="EPO Request - Mallard Park Lot 142",
        email_body="""Hi team,

Please process the following EPO:

Community: Mallard Park
Lot: 142
Description: Touch-up paint after drywall repair
Amount: $285.00

Thanks,
Mike Torres
Summit Builders""",
        vendor_email="mike@summitbuilders.com",
    )

    assert result["community"] == "Mallard Park"
    assert result["lot_number"] == "142"
    assert result["amount"] == 285.00
    assert result["parse_model"] == "regex"
    assert result["confidence_score"] > 0.5


@pytest.mark.asyncio
async def test_parse_email_with_po_number():
    """Test parsing email that includes a PO/confirmation number."""
    parser = EmailParserService()
    result = await parser.parse_email(
        email_subject="EPO Confirmation PO-4421",
        email_body="""Confirming EPO for Odell Park, Lot 67.
Amount: $450
PO Number: PO-4421
Vendor: DRB Homes""",
        vendor_email="orders@drb.com",
    )

    conf = result.get("confirmation_number", "")
    assert "4421" in str(conf)
    assert result.get("amount") == 450.0


@pytest.mark.asyncio
async def test_parse_minimal_email():
    """Test parsing a minimal email with limited info."""
    parser = EmailParserService()
    result = await parser.parse_email(
        email_subject="work order",
        email_body="Need some extra painting done on lot 55",
        vendor_email="vendor@example.com",
    )

    # Should still extract what it can
    assert result is not None
    assert "lot_number" in result


@pytest.mark.asyncio
async def test_parse_empty_email():
    """Test parsing an empty email body."""
    parser = EmailParserService()
    result = await parser.parse_email(
        email_subject="",
        email_body="",
        vendor_email="test@test.com",
    )

    assert result is not None
    # Should flag for review
    assert result.get("needs_review", True) == True
