"""
Demo endpoints for testing and video demonstrations.
NO AUTH REQUIRED — these are for demo/dev only.
"""

from datetime import datetime, timedelta
from random import randint, choice, uniform
from fastapi import APIRouter, Depends
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.auth import get_password_hash
from ..models.models import (
    Company, User, EPO, EPOFollowup, CommunityAssignment,
    UserRole, Industry, PlanTier, EPOStatus,
)
from ..models.schemas import SimulateEmailRequest
from ..services.email_parser import EmailParserService
from .vendor_portal import generate_vendor_token

router = APIRouter(prefix="/api/demo", tags=["demo"])

COMMUNITIES = ["Mallard Park", "Odell Park", "Galloway", "Cedar Hills", "Olmsted", "Ridgeview"]

VENDORS = [
    ("Pulte Homes", "orders@pultehomes.com"),
    ("Summit Builders", "epo@summitbuilders.com"),
    ("DRB Homes", "submissions@drbhomes.com"),
    ("K. Hovnanian", "extrawork@khovananian.com"),
    ("Ryan Homes", "epo@ryanhomes.com"),
    ("Meritage Homes", "orders@meritage.com"),
]

DESCRIPTIONS = [
    "Touch-up paint after drywall repair, master bedroom ceiling",
    "Extra coat exterior trim - color mismatch from original spec",
    "Ceiling repair and repaint after plumbing leak",
    "Garage floor paint - wrong color applied by sub crew",
    "Accent wall repaint - homeowner change order post-walkthrough",
    "Exterior siding paint correction on south-facing elevation",
    "Bathroom vanity area moisture damage repaint",
    "Stairwell scuff repair from move-in damage",
    "Drywall finishing and taping - additional 300 sq ft",
    "Kitchen cabinet painting - changed from stain to paint",
    "Full interior paint package upgrade to premium grade",
    "Ceiling texture and paint - popcorn removal and smooth finish",
    "Interior trim painting - all doors and baseboards",
    "Drywall patch and paint - electrical rough-in damage",
    "Exterior soffit and fascia repaint - peeling from weather",
]

# Supervisor assignments for demo
SUPERVISORS = [
    {
        "full_name": "Gabriel Jordao (Demo)",
        "email": "gabriel-demo@stancilservices.com",
        "role": UserRole.ADMIN,
        "communities": COMMUNITIES,  # Boss sees all
    },
    {
        "full_name": "Marcus Rivera",
        "email": "marcus@stancilservices.com",
        "role": UserRole.FIELD,
        "communities": ["Mallard Park", "Odell Park"],
    },
    {
        "full_name": "Tyler Brooks",
        "email": "tyler@stancilservices.com",
        "role": UserRole.FIELD,
        "communities": ["Galloway", "Cedar Hills"],
    },
    {
        "full_name": "James Whitfield",
        "email": "james@stancilservices.com",
        "role": UserRole.FIELD,
        "communities": ["Olmsted", "Ridgeview"],
    },
]


async def _ensure_demo_company(session: AsyncSession) -> tuple:
    """Ensure demo company and all supervisors exist."""
    result = await session.execute(select(Company).where(Company.name == "Stancil Painting & Drywall"))
    company = result.scalars().first()

    if not company:
        company = Company(
            name="Stancil Painting & Drywall",
            industry=Industry.PAINT,
            plan_tier=PlanTier.PRO,
        )
        session.add(company)
        await session.flush()

    users = []
    for sup in SUPERVISORS:
        result = await session.execute(select(User).where(User.email == sup["email"]))
        user = result.scalars().first()

        if not user:
            user = User(
                company_id=company.id,
                email=sup["email"],
                full_name=sup["full_name"],
                hashed_password=get_password_hash("demo123"),
                role=sup["role"],
            )
            session.add(user)
            await session.flush()

            # Create community assignments (skip admin — admin sees all by role)
            if sup["role"] != UserRole.ADMIN:
                for comm in sup["communities"]:
                    assignment = CommunityAssignment(
                        company_id=company.id,
                        supervisor_id=user.id,
                        community_name=comm,
                    )
                    session.add(assignment)

        users.append(user)

    await session.flush()
    return company, users[0], users  # company, admin_user, all_users


@router.post("/seed")
async def seed_database(session: AsyncSession = Depends(get_db)) -> dict:
    """Seed database with realistic demo data including team. No auth required."""
    company, admin, all_users = await _ensure_demo_company(session)

    # Clear existing data
    await session.execute(delete(EPOFollowup).where(EPOFollowup.company_id == company.id))
    await session.execute(delete(EPO).where(EPO.company_id == company.id))

    # Build supervisor→community lookup (excluding admin)
    field_supervisors = [u for u in all_users if u.role != UserRole.ADMIN]
    community_to_supervisor = {}
    for sup in SUPERVISORS:
        if sup["role"] != UserRole.ADMIN:
            user = next(u for u in all_users if u.email == sup["email"])
            for comm in sup["communities"]:
                community_to_supervisor[comm] = user.id

    statuses = (
        [EPOStatus.CONFIRMED] * 10 +
        [EPOStatus.PENDING] * 9 +
        [EPOStatus.DENIED] * 4 +
        [EPOStatus.DISCOUNT] * 2
    )

    epos_created = 0
    for i in range(25):
        vendor_name, vendor_email = choice(VENDORS)
        epo_status = statuses[i] if i < len(statuses) else choice(list(EPOStatus))
        days_old = randint(0, 30)
        amount = round(uniform(150, 1200), 2)
        community = choice(COMMUNITIES)

        # Assign to the supervisor who owns this community
        supervisor_id = community_to_supervisor.get(community, admin.id)

        epo = EPO(
            company_id=company.id,
            created_by_id=supervisor_id,
            vendor_name=vendor_name,
            vendor_email=vendor_email,
            community=community,
            lot_number=str(randint(1, 300)),
            description=choice(DESCRIPTIONS),
            amount=amount,
            status=epo_status,
            confirmation_number=f"PO-{randint(4000, 4999)}" if epo_status == EPOStatus.CONFIRMED else None,
            days_open=days_old,
            confidence_score=round(uniform(0.82, 0.99), 2),
            needs_review=(epo_status == EPOStatus.PENDING and days_old > 5),
            parse_model=choice(["regex", "regex", "regex", "gemini", "haiku"]),
            synced_from_email=True,
            vendor_token=generate_vendor_token(),
            created_at=datetime.utcnow() - timedelta(days=days_old),
        )
        session.add(epo)
        epos_created += 1

    await session.commit()

    return {
        "success": True,
        "message": f"Seeded {epos_created} EPOs + {len(field_supervisors)} supervisors for Stancil Painting & Drywall",
        "epos_created": epos_created,
        "supervisors_created": len(field_supervisors),
        "company_id": company.id,
    }


@router.post("/simulate-email")
async def simulate_email(
    request: SimulateEmailRequest,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Simulate receiving an EPO email. Parses through 3-tier pipeline."""
    company, admin, all_users = await _ensure_demo_company(session)
    parser = EmailParserService()

    parsed = await parser.parse_email(
        email_subject=request.email_subject,
        email_body=request.email_body,
        vendor_email=request.vendor_email or "",
    )

    # Auto-assign to supervisor based on community
    community = parsed.get("community")
    supervisor_id = admin.id  # default to admin
    if community:
        assign_result = await session.execute(
            select(CommunityAssignment)
            .where(CommunityAssignment.community_name == community)
            .where(CommunityAssignment.company_id == company.id)
        )
        assignment = assign_result.scalars().first()
        if assignment:
            supervisor_id = assignment.supervisor_id

    epo = EPO(
        company_id=company.id,
        created_by_id=supervisor_id,
        vendor_name=parsed.get("vendor_name") or "Unknown Vendor",
        vendor_email=parsed.get("vendor_email") or request.vendor_email or "unknown@example.com",
        community=community,
        lot_number=parsed.get("lot_number"),
        description=parsed.get("description"),
        amount=parsed.get("amount"),
        confirmation_number=parsed.get("confirmation_number"),
        confidence_score=parsed.get("confidence_score"),
        needs_review=parsed.get("needs_review", False),
        parse_model=parsed.get("parse_model"),
        raw_email_subject=request.email_subject,
        raw_email_body=request.email_body,
        synced_from_email=True,
        vendor_token=generate_vendor_token(),
        days_open=0,
        status=EPOStatus.PENDING,
    )
    session.add(epo)
    await session.commit()
    await session.refresh(epo)

    # Look up who it was assigned to
    assigned_to = "Unassigned"
    if supervisor_id:
        user_result = await session.execute(select(User).where(User.id == supervisor_id))
        assigned_user = user_result.scalars().first()
        if assigned_user:
            assigned_to = assigned_user.full_name

    return {
        "success": True,
        "epo_id": epo.id,
        "parsed_data": parsed,
        "parse_model": parsed.get("parse_model", "unknown"),
        "vendor_name": epo.vendor_name,
        "amount": epo.amount,
        "community": epo.community,
        "lot_number": epo.lot_number,
        "confidence_score": epo.confidence_score,
        "assigned_to": assigned_to,
    }


@router.get("/epos")
async def get_demo_epos(
    status: str = None,
    supervisor_id: int = None,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get EPOs. Optionally filter by supervisor (their communities)."""
    query = select(EPO).order_by(EPO.created_at.desc())

    if supervisor_id:
        # Get supervisor's communities
        assign_result = await session.execute(
            select(CommunityAssignment.community_name)
            .where(CommunityAssignment.supervisor_id == supervisor_id)
        )
        communities = [row[0] for row in assign_result.all()]
        if communities:
            query = query.where(EPO.community.in_(communities))
        else:
            query = query.where(EPO.created_by_id == supervisor_id)

    if status and status != "all":
        query = query.where(EPO.status == status)

    result = await session.execute(query)
    epos = result.scalars().all()

    return {
        "epos": [
            {
                "id": e.id,
                "vendor_name": e.vendor_name,
                "vendor_email": e.vendor_email,
                "community": e.community,
                "lot_number": e.lot_number,
                "description": e.description,
                "amount": e.amount,
                "status": e.status.value if hasattr(e.status, 'value') else e.status,
                "confirmation_number": e.confirmation_number,
                "days_open": e.days_open,
                "needs_review": e.needs_review,
                "confidence_score": e.confidence_score,
                "parse_model": e.parse_model,
                "synced_from_email": e.synced_from_email,
                "created_at": e.created_at.isoformat() if e.created_at else None,
            }
            for e in epos
        ],
        "total": len(epos),
    }


@router.get("/stats")
async def get_demo_stats(
    supervisor_id: int = None,
    session: AsyncSession = Depends(get_db),
) -> dict:
    """Get dashboard stats. Optionally scoped to a supervisor's communities."""
    query = select(EPO)

    if supervisor_id:
        assign_result = await session.execute(
            select(CommunityAssignment.community_name)
            .where(CommunityAssignment.supervisor_id == supervisor_id)
        )
        communities = [row[0] for row in assign_result.all()]
        if communities:
            query = query.where(EPO.community.in_(communities))
        else:
            query = query.where(EPO.created_by_id == supervisor_id)

    result = await session.execute(query)
    epos = result.scalars().all()

    if not epos:
        return {"total": 0, "confirmed": 0, "pending": 0, "denied": 0, "discount": 0,
                "total_value": 0, "capture_rate": 0, "needs_followup": 0, "avg_amount": 0}

    statuses = {}
    total_value = 0
    needs_followup = 0
    for e in epos:
        s = e.status.value if hasattr(e.status, 'value') else e.status
        statuses[s] = statuses.get(s, 0) + 1
        total_value += e.amount or 0
        if s == "pending" and (e.days_open or 0) >= 4:
            needs_followup += 1

    total = len(epos)
    confirmed = statuses.get("confirmed", 0)

    return {
        "total": total,
        "confirmed": confirmed,
        "pending": statuses.get("pending", 0),
        "denied": statuses.get("denied", 0),
        "discount": statuses.get("discount", 0),
        "total_value": round(total_value, 2),
        "capture_rate": round(confirmed / total * 100) if total else 0,
        "needs_followup": needs_followup,
        "avg_amount": round(total_value / total, 2) if total else 0,
    }


@router.post("/reset")
async def reset_database(session: AsyncSession = Depends(get_db)) -> dict:
    """Reset and re-seed. No auth required."""
    await session.execute(delete(EPOFollowup))
    await session.execute(delete(EPO))
    await session.execute(delete(CommunityAssignment))
    await session.execute(delete(User))
    await session.execute(delete(Company))
    await session.commit()
    return await seed_database(session=session)
