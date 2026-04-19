"""
Stripe billing API — checkout sessions, webhooks, customer portal, subscription management.
"""

import logging
from typing import Optional

import stripe
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.auth import get_current_user
from ..core.config import get_settings
from ..core.database import get_db
from ..models.models import Company, PlanTier, User, UserRole

logger = logging.getLogger("epo_tracker.billing")
router = APIRouter(prefix="/api/billing", tags=["billing"])

settings = get_settings()
stripe.api_key = settings.STRIPE_SECRET_KEY

# ─── Tier ↔ Stripe price mapping ─────────────────
# Prices are created via the /api/billing/setup-products endpoint
# or manually in Stripe Dashboard. We store price IDs here after creation.
PLAN_PRICES: dict[str, dict] = {}  # populated by _load_prices()

PLAN_LIMITS = {
    PlanTier.STARTER: {"users": 5, "epos_per_month": 100, "price_monthly": 4900},
    PlanTier.PRO: {"users": 15, "epos_per_month": 500, "price_monthly": 14900},
    PlanTier.BUSINESS: {"users": 50, "epos_per_month": 2000, "price_monthly": 34900},
    PlanTier.ENTERPRISE: {"users": -1, "epos_per_month": -1, "price_monthly": 0},
}


# ─── Pydantic schemas ────────────────────────────
class CheckoutRequest(BaseModel):
    plan: str  # starter, pro, business
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class OneTimePaymentRequest(BaseModel):
    amount_cents: int  # amount in cents
    description: str
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


class BillingStatusResponse(BaseModel):
    plan: str
    stripe_subscription_status: Optional[str]
    stripe_customer_id: Optional[str]
    billing_email: Optional[str]
    limits: dict


# ─── Helper: ensure Stripe customer exists ────────
async def _ensure_stripe_customer(
    company: Company, user: User, session: AsyncSession
) -> str:
    """Get or create a Stripe customer for this company."""
    if company.stripe_customer_id:
        return company.stripe_customer_id

    customer = stripe.Customer.create(
        name=company.name,
        email=user.email,
        metadata={"company_id": str(company.id), "created_by": str(user.id)},
    )
    company.stripe_customer_id = customer.id
    company.billing_email = user.email
    session.add(company)
    await session.commit()
    logger.info(f"Created Stripe customer {customer.id} for company {company.id}")
    return customer.id


async def _get_company(user: User, session: AsyncSession) -> Company:
    result = await session.execute(
        select(Company).where(Company.id == user.company_id)
    )
    company = result.scalars().first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


def _require_admin(user: User):
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can manage billing",
        )


# ─── GET /api/billing/status ─────────────────────
@router.get("/status")
async def billing_status(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get current billing status for the company."""
    company = await _get_company(user, session)
    plan = company.plan_tier or PlanTier.STARTER
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS[PlanTier.STARTER])

    return {
        "plan": plan.value,
        "stripe_subscription_status": company.stripe_subscription_status,
        "stripe_customer_id": company.stripe_customer_id,
        "billing_email": company.billing_email,
        "limits": limits,
    }


# ─── POST /api/billing/checkout ──────────────────
@router.post("/checkout")
async def create_checkout_session(
    req: CheckoutRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a Stripe Checkout Session for a subscription plan."""
    _require_admin(user)

    plan_key = req.plan.lower()
    if plan_key not in ("starter", "pro", "business"):
        raise HTTPException(400, "Invalid plan. Choose starter, pro, or business.")

    if plan_key == "enterprise":
        raise HTTPException(400, "Enterprise plans require custom setup. Contact sales.")

    company = await _get_company(user, session)
    customer_id = await _ensure_stripe_customer(company, user, session)

    # Look up the price for this plan
    price_id = await _get_price_id(plan_key)
    if not price_id:
        raise HTTPException(500, f"Price not configured for plan: {plan_key}")

    app_url = settings.APP_URL.rstrip("/")
    checkout = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{"price": price_id, "quantity": 1}],
        success_url=req.success_url or f"{app_url}/settings?billing=success",
        cancel_url=req.cancel_url or f"{app_url}/settings?billing=canceled",
        metadata={"company_id": str(company.id), "plan": plan_key},
        subscription_data={
            "metadata": {"company_id": str(company.id), "plan": plan_key},
        },
    )

    logger.info(
        f"Created checkout session {checkout.id} for company {company.id} plan={plan_key}"
    )
    return {"checkout_url": checkout.url, "session_id": checkout.id}


# ─── POST /api/billing/one-time ──────────────────
@router.post("/one-time")
async def create_one_time_payment(
    req: OneTimePaymentRequest,
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a one-time payment checkout session."""
    _require_admin(user)

    if req.amount_cents < 100:
        raise HTTPException(400, "Minimum amount is $1.00 (100 cents)")

    company = await _get_company(user, session)
    customer_id = await _ensure_stripe_customer(company, user, session)

    app_url = settings.APP_URL.rstrip("/")
    checkout = stripe.checkout.Session.create(
        customer=customer_id,
        mode="payment",
        line_items=[{
            "price_data": {
                "currency": "usd",
                "product_data": {"name": req.description},
                "unit_amount": req.amount_cents,
            },
            "quantity": 1,
        }],
        success_url=req.success_url or f"{app_url}/settings?payment=success",
        cancel_url=req.cancel_url or f"{app_url}/settings?payment=canceled",
        metadata={"company_id": str(company.id), "type": "one_time"},
    )

    logger.info(
        f"Created one-time payment {checkout.id} for company {company.id} amount={req.amount_cents}"
    )
    return {"checkout_url": checkout.url, "session_id": checkout.id}


# ─── POST /api/billing/portal ────────────────────
@router.post("/portal")
async def create_portal_session(
    user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Create a Stripe Customer Portal session for self-service billing management."""
    _require_admin(user)

    company = await _get_company(user, session)
    if not company.stripe_customer_id:
        raise HTTPException(400, "No billing account found. Subscribe to a plan first.")

    app_url = settings.APP_URL.rstrip("/")
    portal = stripe.billing_portal.Session.create(
        customer=company.stripe_customer_id,
        return_url=f"{app_url}/settings",
    )

    return {"portal_url": portal.url}


# ─── POST /api/billing/webhook ───────────────────
@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    session: AsyncSession = Depends(get_db),
):
    """Handle Stripe webhook events."""
    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    # ── Webhook signature verification ──
    if not settings.STRIPE_WEBHOOK_SECRET:
        if settings.ENVIRONMENT == "production":
            logger.critical("STRIPE_WEBHOOK_SECRET is not set in production — refusing webhook")
            raise HTTPException(500, "Webhook not configured")
        # Local dev only — allow unsigned payload for testing
        logger.warning("Processing unsigned Stripe webhook — DEV MODE ONLY")
        import json
        event = stripe.Event.construct_from(json.loads(payload), stripe.api_key)
    else:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except stripe.error.SignatureVerificationError:
            logger.warning("Stripe webhook signature verification failed")
            raise HTTPException(400, "Invalid signature")

    event_type = event["type"]
    data = event["data"]["object"]
    logger.info(f"Stripe webhook: {event_type}")

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(data, session)
    elif event_type in (
        "customer.subscription.updated",
        "customer.subscription.deleted",
    ):
        await _handle_subscription_change(data, session)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data, session)
    elif event_type == "invoice.paid":
        await _handle_invoice_paid(data, session)

    return JSONResponse({"status": "ok"})


# ─── Webhook handlers ────────────────────────────
async def _handle_checkout_completed(data: dict, session: AsyncSession):
    """After successful checkout, update company plan and subscription info."""
    company_id = data.get("metadata", {}).get("company_id")
    plan = data.get("metadata", {}).get("plan")
    subscription_id = data.get("subscription")

    if not company_id:
        logger.warning("checkout.session.completed missing company_id metadata")
        return

    result = await session.execute(
        select(Company).where(Company.id == int(company_id))
    )
    company = result.scalars().first()
    if not company:
        logger.warning(f"Company {company_id} not found for checkout completion")
        return

    if subscription_id:
        company.stripe_subscription_id = subscription_id
        company.stripe_subscription_status = "active"

    if plan:
        tier_map = {
            "starter": PlanTier.STARTER,
            "pro": PlanTier.PRO,
            "business": PlanTier.BUSINESS,
            "enterprise": PlanTier.ENTERPRISE,
        }
        company.plan_tier = tier_map.get(plan, PlanTier.STARTER)

    if data.get("customer_details", {}).get("email"):
        company.billing_email = data["customer_details"]["email"]

    session.add(company)
    await session.commit()
    logger.info(
        f"Company {company_id} upgraded to {plan}, subscription={subscription_id}"
    )


async def _handle_subscription_change(data: dict, session: AsyncSession):
    """Handle subscription updates (upgrades, downgrades, cancellations)."""
    subscription_id = data.get("id")
    stripe_status = data.get("status")  # active, past_due, canceled, unpaid
    company_id = data.get("metadata", {}).get("company_id")
    plan = data.get("metadata", {}).get("plan")

    if not company_id:
        # Try finding by subscription ID
        result = await session.execute(
            select(Company).where(
                Company.stripe_subscription_id == subscription_id
            )
        )
        company = result.scalars().first()
    else:
        result = await session.execute(
            select(Company).where(Company.id == int(company_id))
        )
        company = result.scalars().first()

    if not company:
        logger.warning(f"Company not found for subscription {subscription_id}")
        return

    company.stripe_subscription_status = stripe_status

    # If canceled, downgrade to starter
    if stripe_status == "canceled":
        company.plan_tier = PlanTier.STARTER
        company.stripe_subscription_id = None
        logger.info(f"Company {company.id} subscription canceled, downgraded to starter")
    elif plan:
        tier_map = {
            "starter": PlanTier.STARTER,
            "pro": PlanTier.PRO,
            "business": PlanTier.BUSINESS,
            "enterprise": PlanTier.ENTERPRISE,
        }
        new_tier = tier_map.get(plan)
        if new_tier:
            company.plan_tier = new_tier

    session.add(company)
    await session.commit()


async def _handle_payment_failed(data: dict, session: AsyncSession):
    """Handle failed invoice payments — mark subscription as past_due."""
    subscription_id = data.get("subscription")
    if not subscription_id:
        return

    result = await session.execute(
        select(Company).where(
            Company.stripe_subscription_id == subscription_id
        )
    )
    company = result.scalars().first()
    if company:
        company.stripe_subscription_status = "past_due"
        session.add(company)
        await session.commit()
        logger.warning(f"Payment failed for company {company.id}")


async def _handle_invoice_paid(data: dict, session: AsyncSession):
    """When an invoice is paid, reactivate the subscription if it was past_due."""
    subscription_id = data.get("subscription")
    if not subscription_id:
        return

    result = await session.execute(
        select(Company).where(Company.stripe_subscription_id == subscription_id)
    )
    company = result.scalars().first()
    if company and company.stripe_subscription_status == "past_due":
        company.stripe_subscription_status = "active"
        session.add(company)
        await session.commit()
        logger.info(f"Company {company.id} reactivated after invoice paid")


# ─── GET /api/billing/plans ──────────────────────
@router.get("/plans")
async def list_plans():
    """Public endpoint: list available plans with pricing."""
    return {
        "plans": [
            {
                "id": "starter",
                "name": "Starter",
                "price_monthly": 49,
                "price_cents": 4900,
                "features": [
                    "Up to 5 users",
                    "100 EPOs/month",
                    "Email parsing (regex)",
                    "Basic dashboard",
                    "Email support",
                ],
            },
            {
                "id": "pro",
                "name": "Pro",
                "price_monthly": 149,
                "price_cents": 14900,
                "features": [
                    "Up to 15 users",
                    "500 EPOs/month",
                    "AI email parsing (Gemini + Claude)",
                    "Vendor portal",
                    "Gmail integration",
                    "Export reports",
                    "Priority support",
                ],
            },
            {
                "id": "business",
                "name": "Business",
                "price_monthly": 349,
                "price_cents": 34900,
                "features": [
                    "Up to 50 users",
                    "2,000 EPOs/month",
                    "All Pro features",
                    "BuildPro/SupplyPro portal sync",
                    "Approval workflows",
                    "SMS notifications",
                    "API access",
                    "Dedicated account manager",
                ],
            },
            {
                "id": "enterprise",
                "name": "Enterprise",
                "price_monthly": None,
                "price_cents": None,
                "features": [
                    "Unlimited users",
                    "Unlimited EPOs",
                    "All Business features",
                    "Custom integrations",
                    "White-label options",
                    "SLA guarantee",
                    "On-premise deployment",
                    "24/7 phone support",
                ],
            },
        ],
    }


# ─── POST /api/billing/setup-products ────────────
@router.post("/setup-products")
async def setup_stripe_products(
    user: User = Depends(get_current_user),
):
    """One-time setup: create Stripe products and prices for all tiers.
    Admin-only. Idempotent — skips existing products."""
    _require_admin(user)

    if not settings.STRIPE_SECRET_KEY:
        raise HTTPException(500, "Stripe secret key not configured")

    created = []
    plans = [
        ("starter", "EPO Tracker — Starter", 4900),
        ("pro", "EPO Tracker — Pro", 14900),
        ("business", "EPO Tracker — Business", 34900),
    ]

    for plan_id, name, price_cents in plans:
        # Check if product already exists
        existing = stripe.Product.search(query=f'metadata["plan_id"]:"{plan_id}"')
        if existing.data:
            product = existing.data[0]
            logger.info(f"Product for {plan_id} already exists: {product.id}")
        else:
            product = stripe.Product.create(
                name=name,
                metadata={"plan_id": plan_id},
                description=f"EPO Tracker {plan_id.title()} plan — monthly subscription",
            )
            logger.info(f"Created product {product.id} for {plan_id}")

        # Check if monthly price exists
        prices = stripe.Price.list(product=product.id, active=True)
        monthly_price = None
        for p in prices.data:
            if (
                p.recurring
                and p.recurring.interval == "month"
                and p.unit_amount == price_cents
            ):
                monthly_price = p
                break

        if not monthly_price:
            monthly_price = stripe.Price.create(
                product=product.id,
                unit_amount=price_cents,
                currency="usd",
                recurring={"interval": "month"},
                metadata={"plan_id": plan_id},
            )
            logger.info(f"Created price {monthly_price.id} for {plan_id}")

        created.append({
            "plan": plan_id,
            "product_id": product.id,
            "price_id": monthly_price.id,
            "amount": price_cents,
        })

    return {"products": created}


# ─── Helper: look up price ID for a plan ─────────
async def _get_price_id(plan_id: str) -> Optional[str]:
    """Look up the Stripe price ID for a given plan by searching products."""
    try:
        products = stripe.Product.search(
            query=f'metadata["plan_id"]:"{plan_id}"'
        )
        if not products.data:
            return None

        product = products.data[0]
        prices = stripe.Price.list(product=product.id, active=True)
        for p in prices.data:
            if p.recurring and p.recurring.interval == "month":
                return p.id
        return None
    except Exception as e:
        logger.error(f"Error looking up price for {plan_id}: {e}")
        return None


# ─── GET /api/billing/config ─────────────────────
@router.get("/config")
async def billing_config():
    """Return publishable key for frontend Stripe.js initialization."""
    return {"publishable_key": settings.STRIPE_PUBLISHABLE_KEY}
