import logging
import secrets
from datetime import datetime, timedelta

import resend
from fastapi import APIRouter, Depends, HTTPException, status, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.config import get_settings
from ..core.rate_limit import limiter
from ..core.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    validate_password_strength,
    decode_token,
    get_current_user,
)
from ..models.models import User, Company, UserRole, PasswordResetToken, NotificationPreference, EPO
from ..core.circuit_breaker import resend_breaker
from ..models.schemas import (
    LoginRequest,
    TokenResponse,
    UserResponse,
    RegisterRequest,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ChangePasswordRequest,
    RefreshTokenRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=TokenResponse)
@limiter.limit("3/minute")
async def register(
    request: Request,
    register_request: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Register a new user. If invite_code is provided, join existing company.
    Otherwise, create a new company."""

    # Check if user already exists
    query = select(User).where(User.email == register_request.email)
    result = await session.execute(query)
    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    if register_request.invite_code:
        # ââ Join existing company via invite code ââ
        query = select(Company).where(Company.invite_code == register_request.invite_code.strip().upper())
        result = await session.execute(query)
        company = result.scalars().first()
        if not company:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid invite code. Check with your manager and try again.",
            )
    else:
        # ââ Create new company ââ
        if not register_request.company_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Company name is required when creating a new account.",
            )
        invite_code = secrets.token_hex(8).upper()  # 16-char hex code
        company = Company(
            name=register_request.company_name,
            industry=register_request.industry,
            plan_tier="starter",
            invite_code=invite_code,
        )
        session.add(company)
        await session.flush()

    # Create user â also set work_email so the FROM-matching works
    hashed_password = get_password_hash(register_request.password)
    # First user creating a new company is always ADMIN
    if not register_request.invite_code:
        user_role = UserRole.ADMIN
    else:
        role_map = {"field": UserRole.FIELD, "manager": UserRole.MANAGER, "admin": UserRole.ADMIN}
        user_role = role_map.get(register_request.role, UserRole.FIELD)

    # Generate email verification code
    verification_code = str(secrets.randbelow(1000000)).zfill(6)

    user = User(
        email=register_request.email,
        work_email=register_request.email,  # Set work_email for EPO FROM-matching
        full_name=register_request.full_name,
        hashed_password=hashed_password,
        company_id=company.id,
        role=user_role,
        email_verified=False,
        email_verification_code=verification_code,
        email_verification_expires=datetime.utcnow() + timedelta(hours=24),
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # Send verification email (best effort â don't block registration)
    try:
        if resend_breaker.can_execute():
            resend.api_key = settings.RESEND_API_KEY
            resend.Emails.send({
                "from": f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM_ADDRESS}>",
                "to": [user.email],
                "subject": "Verify your EPO Tracker email",
                "html": f"""
                <h2>Welcome to Onyx EPO Tracker!</h2>
                <p>Hi {user.full_name},</p>
                <p>Please verify your email address with this code:</p>
                <h3 style="font-family: monospace; letter-spacing: 0.2em; font-size: 24px;">{verification_code}</h3>
                <p>This code expires in 24 hours.</p>
                """,
            })
            resend_breaker.record_success()
    except Exception as e:
        resend_breaker.record_failure()
        logger.error(f"Failed to send verification email: {e}")

    # Create access and refresh tokens
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_refresh_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.post("/verify-email")
@limiter.limit("10/minute")
async def verify_email(
    request: Request,
    body: dict,
    session: AsyncSession = Depends(get_db),
):
    """Verify email address using the 6-digit code sent during registration."""
    email = body.get("email", "").strip().lower()
    code = body.get("code", "").strip()

    if not email or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and verification code are required.",
        )

    query = select(User).where(User.email == email)
    result = await session.execute(query)
    user = result.scalars().first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or verification code.",
        )

    if user.email_verified:
        return {"success": True, "message": "Email already verified."}

    # Check code and expiration
    if (
        user.email_verification_code != code
        or not user.email_verification_expires
        or user.email_verification_expires < datetime.utcnow()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired verification code.",
        )

    user.email_verified = True
    user.email_verification_code = None
    user.email_verification_expires = None
    await session.commit()

    return {"success": True, "message": "Email verified successfully!"}


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(
    request: Request,
    login_request: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Login with email and password"""

    # Check for account lockout due to too many failed attempts
    _check_login_lockout(login_request.email)

    query = select(User).where(User.email == login_request.email)
    result = await session.execute(query)
    user = result.scalars().first()

    if not user or not verify_password(login_request.password, user.hashed_password or ""):
        _track_failed_login(login_request.email)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    # Clear failed login tracking on successful login
    _clear_failed_logins(login_request.email)

    # Create access and refresh tokens
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    refresh_token = create_refresh_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
) -> UserResponse:
    """Get current authenticated user"""
    return UserResponse.model_validate(current_user)


@router.put("/profile")
@limiter.limit("60/minute")
async def update_profile(
    request: Request,
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update user profile (full name)."""
    full_name = body.get("full_name", "").strip()
    if not full_name:
        raise HTTPException(status_code=400, detail="Full name is required")
    if len(full_name) > 255:
        raise HTTPException(status_code=400, detail="Name too long")

    current_user.full_name = full_name
    await session.commit()
    await session.refresh(current_user)
    logger.info(f"User {current_user.id} updated full_name to '{full_name}'")
    return {"success": True, "full_name": current_user.full_name}


@router.put("/notifications")
@limiter.limit("60/minute")
async def update_notifications(
    request: Request,
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Update notification preferences and phone number."""
    # Get or create notification preferences
    query = select(NotificationPreference).where(
        NotificationPreference.user_id == current_user.id
    )
    result = await session.execute(query)
    prefs = result.scalars().first()

    if not prefs:
        prefs = NotificationPreference(
            user_id=current_user.id,
            company_id=current_user.company_id,
        )
        session.add(prefs)

    # Update fields if provided
    if "email_enabled" in body:
        prefs.email_enabled = bool(body["email_enabled"])
    if "sms_enabled" in body:
        prefs.sms_enabled = bool(body["sms_enabled"])
    if "push_enabled" in body:
        prefs.push_enabled = bool(body["push_enabled"])
    if "phone_number" in body:
        prefs.phone_number = body["phone_number"]
    if "notify_new_epo" in body:
        prefs.notify_new_epo = bool(body["notify_new_epo"])
    if "notify_status_change" in body:
        prefs.notify_status_change = bool(body["notify_status_change"])
    if "notify_approval_needed" in body:
        prefs.notify_approval_needed = bool(body["notify_approval_needed"])
    if "notify_overdue" in body:
        prefs.notify_overdue = bool(body["notify_overdue"])

    await session.commit()
    logger.info(f"User {current_user.id} updated notification preferences")
    return {
        "success": True,
        "email_enabled": prefs.email_enabled,
        "sms_enabled": prefs.sms_enabled,
        "push_enabled": prefs.push_enabled,
        "phone_number": prefs.phone_number,
        "notify_new_epo": prefs.notify_new_epo,
        "notify_status_change": prefs.notify_status_change,
        "notify_approval_needed": prefs.notify_approval_needed,
        "notify_overdue": prefs.notify_overdue,
    }


@router.get("/notifications")
async def get_notifications(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get current notification preferences."""
    query = select(NotificationPreference).where(
        NotificationPreference.user_id == current_user.id
    )
    result = await session.execute(query)
    prefs = result.scalars().first()

    if not prefs:
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


@router.post("/export-data")
async def export_data(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Export user's company EPO data as CSV."""
    import csv
    import io
    from fastapi.responses import StreamingResponse

    query = select(EPO).where(
        EPO.company_id == current_user.company_id
    ).order_by(EPO.created_at.desc())
    result = await session.execute(query)
    epos = result.scalars().all()

    # Build CSV in memory
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "ID", "Builder", "Community", "Lot", "Description",
        "Amount", "Status", "Confirmation #", "Created",
    ])
    for e in epos:
        writer.writerow([
            e.id, e.vendor_name, e.community, e.lot_number,
            e.description, e.amount, e.status.value if e.status else "",
            e.confirmation_number,
            e.created_at.strftime("%Y-%m-%d") if e.created_at else "",
        ])

    output.seek(0)
    logger.info(f"User {current_user.id} exported {len(epos)} EPOs")
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=epo-export.csv"},
    )


@router.delete("/account")
async def delete_account(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Deactivate user account (soft delete)."""
    current_user.is_active = False
    await session.commit()
    logger.info(f"User {current_user.id} ({current_user.email}) deactivated their account")
    return {"success": True, "message": "Account deactivated"}


@router.get("/invite-code")
async def get_invite_code(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get the company's invite code for sharing with team members."""
    query = select(Company).where(Company.id == current_user.company_id)
    result = await session.execute(query)
    company = result.scalars().first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Generate invite code if company doesn't have one yet (legacy companies)
    if not company.invite_code:
        company.invite_code = secrets.token_hex(8).upper()
        await session.commit()
        await session.refresh(company)

    return {
        "invite_code": company.invite_code,
        "company_name": company.name,
    }


@router.post("/join-team")
@limiter.limit("5/15minutes")
async def join_team(
    request: Request,
    body: dict,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Allow an existing user to join a different company using an invite code.
    This moves the user from their current (solo) company to the invited company.
    Rate limited to 5 attempts per 15 minutes per IP (via slowapi)."""

    invite_code = body.get("invite_code", "").strip().upper()
    if not invite_code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invite code is required.",
        )

    # Find the target company
    query = select(Company).where(Company.invite_code == invite_code)
    result = await session.execute(query)
    target_company = result.scalars().first()
    if not target_company:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invite code. Check with your manager and try again.",
        )

    # Don't allow joining the same company
    if target_company.id == current_user.company_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You are already a member of this company.",
        )

    # Move user to the new company
    current_user.company_id = target_company.id
    # Downgrade to FIELD role when joining (manager can promote later)
    if current_user.role == UserRole.ADMIN:
        current_user.role = UserRole.FIELD

    await session.commit()
    await session.refresh(current_user)

    # Clean up: if old company has no users left, we could delete it
    # (optional â leaving it for now)

    return {
        "success": True,
        "message": f"Successfully joined {target_company.name}!",
        "company_name": target_company.name,
        "company_id": target_company.id,
    }


# Rate limiting helper - tracks request count per key
_rate_limit_store = {}
_RATE_LIMIT_MAX_KEYS = 10000  # Prevent unbounded memory growth

# Failed login tracker
_failed_login_store = {}


def check_rate_limit(key: str, max_requests: int, window_seconds: int) -> bool:
    """Simple in-memory rate limiter. In production, use Redis."""
    now = datetime.utcnow()
    if key not in _rate_limit_store:
        _rate_limit_store[key] = []

    # Remove old requests outside the window
    _rate_limit_store[key] = [
        timestamp for timestamp in _rate_limit_store[key]
        if (now - timestamp).total_seconds() < window_seconds
    ]

    # Periodic cleanup: evict stale keys when store gets large
    if len(_rate_limit_store) > _RATE_LIMIT_MAX_KEYS:
        stale = [k for k, v in _rate_limit_store.items() if not v]
        for k in stale:
            del _rate_limit_store[k]

    # Check if we've exceeded the limit
    if len(_rate_limit_store[key]) >= max_requests:
        return False

    _rate_limit_store[key].append(now)
    return True


def _track_failed_login(email: str):
    """Track a failed login attempt."""
    now = datetime.utcnow()
    key = email.lower()
    if key not in _failed_login_store:
        _failed_login_store[key] = []
    _failed_login_store[key].append(now)


def _check_login_lockout(email: str):
    """Check if account is locked due to too many failed attempts."""
    now = datetime.utcnow()
    key = email.lower()
    if key not in _failed_login_store:
        return
    # Clean old entries (15 min window)
    _failed_login_store[key] = [
        ts for ts in _failed_login_store[key]
        if (now - ts).total_seconds() < 900
    ]
    if len(_failed_login_store[key]) >= 5:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many failed login attempts. Please try again in 15 minutes.",
        )


def _clear_failed_logins(email: str):
    """Clear failed login tracking on successful login."""
    key = email.lower()
    _failed_login_store.pop(key, None)


@router.post("/forgot-password")
@limiter.limit("3/hour")
async def forgot_password(
    request: Request,
    forgot_request: ForgotPasswordRequest,
    session: AsyncSession = Depends(get_db),
):
    """Generate a password reset code and send via email.
    Rate limited to 3 requests per hour per IP (via slowapi)."""

    # Additional per-email rate limiting (prevents one IP targeting multiple emails)
    rate_limit_key = f"forgot_password:{forgot_request.email}"
    if not check_rate_limit(rate_limit_key, max_requests=3, window_seconds=3600):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password reset requests. Please try again in 1 hour.",
        )

    # Find user by email (order by id to be deterministic if duplicates exist)
    query = select(User).where(User.email == forgot_request.email).order_by(User.id)
    result = await session.execute(query)
    user = result.scalars().first()

    # Always return success for security (don't leak if user exists)
    if not user:
        return {
            "success": True,
            "message": "If an account exists with this email, a reset code has been sent.",
        }

    try:
        # Invalidate any existing unused reset tokens for this user
        invalidate_query = select(PasswordResetToken).where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used.is_(False),
        )
        invalidate_result = await session.execute(invalidate_query)
        old_tokens = invalidate_result.scalars().all()
        for old_token in old_tokens:
            old_token.used = True

        # Generate 6-digit code (stored as plain text — short-lived, no need for bcrypt)
        reset_code = str(secrets.randbelow(1000000)).zfill(6)

        # Create reset token with 1 hour expiry
        reset_token = PasswordResetToken(
            user_id=user.id,
            token_hash=reset_code,  # Store plain code (expires in 1hr)
            expires_at=datetime.utcnow() + timedelta(hours=1),
        )
        session.add(reset_token)
        await session.commit()

        # Send email via Resend
        resend.api_key = settings.RESEND_API_KEY
        email_html = f"""
        <h2>Password Reset Request</h2>
        <p>Hi {user.full_name},</p>
        <p>You requested a password reset for your EPO Tracker account.</p>
        <p>Your reset code is:</p>
        <h3 style="font-family: monospace; letter-spacing: 0.2em; font-size: 24px;">{reset_code}</h3>
        <p>This code will expire in 1 hour.</p>
        <p>If you didn't request this, please ignore this email.</p>
        """

        if not settings.RESEND_API_KEY:
            logger.error("RESEND_API_KEY not configured - cannot send reset email")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email service is not configured. Contact your administrator.",
            )

        if resend_breaker.can_execute():
            resend.Emails.send({
                "from": f"{settings.EMAIL_FROM_NAME} <{settings.EMAIL_FROM_ADDRESS}>",
                "to": [user.email],
                "subject": "Your EPO Tracker Password Reset Code",
                "html": email_html,
            })
            resend_breaker.record_success()
            logger.info(f"Password reset email sent to {user.email}")
        else:
            logger.warning("Resend circuit breaker OPEN - skipping email send")
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Email service temporarily unavailable. Try again in a few minutes.",
            )

        return {
            "success": True,
            "message": "If an account exists with this email, a reset code has been sent.",
        }
    except HTTPException:
        raise
    except Exception as e:
        resend_breaker.record_failure()
        logger.error(f"Error sending reset email: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to send reset email. Please try again later.",
        )


@router.post("/verify-reset-code")
@limiter.limit("10/minute")
async def verify_reset_code(
    request: Request,
    body: dict,
    session: AsyncSession = Depends(get_db),
):
    """Verify a password reset code is valid (without resetting the password)."""
    email = (body.get("email") or "").strip().lower()
    code = (body.get("code") or "").strip()

    if not email or not code:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email and code are required.",
        )

    # Find all users with this email
    query = select(User).where(User.email == email).order_by(User.id)
    result = await session.execute(query)
    users = result.scalars().all()

    if not users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code.",
        )

    user_ids = [u.id for u in users]

    # Find valid reset tokens
    query = select(PasswordResetToken).where(
        PasswordResetToken.user_id.in_(user_ids),
        PasswordResetToken.used.is_(False),
        PasswordResetToken.expires_at > datetime.utcnow(),
    ).order_by(PasswordResetToken.created_at.desc())
    result = await session.execute(query)
    reset_tokens = result.scalars().all()

    if not reset_tokens:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code.",
        )

    # Check if code matches any token
    for token in reset_tokens:
        if code == token.token_hash.strip():
            return {"success": True, "message": "Code verified."}

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Invalid or expired reset code.",
    )


@router.post("/reset-password")
@limiter.limit("5/hour")
async def reset_password(
    request: Request,
    reset_req: ResetPasswordRequest,
    session: AsyncSession = Depends(get_db),
):
    """Reset password using email and reset code."""

    # Find ALL users with this email (handles duplicate accounts)
    query = select(User).where(User.email == reset_req.email).order_by(User.id)
    result = await session.execute(query)
    users = result.scalars().all()

    if not users:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email or reset code.",
        )

    # Collect all user IDs for this email
    user_ids = [u.id for u in users]

    # Find valid reset tokens across ALL user accounts with this email
    # Order by newest first so we check the most recent code first
    query = select(PasswordResetToken).where(
        PasswordResetToken.user_id.in_(user_ids),
        PasswordResetToken.used.is_(False),
        PasswordResetToken.expires_at > datetime.utcnow(),
    ).order_by(PasswordResetToken.created_at.desc())
    result = await session.execute(query)
    reset_tokens = result.scalars().all()

    if not reset_tokens:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code.",
        )

    # Try to verify against each token (newest first)
    matched_token = None
    for token in reset_tokens:
        if reset_req.code.strip() == token.token_hash.strip():
            matched_token = token
            break

    if not matched_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset code.",
        )

    reset_token = matched_token

    # Validate password strength
    is_valid, error_msg = validate_password_strength(reset_req.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    # Update password on ALL accounts with this email (handles duplicates)
    new_hash = get_password_hash(reset_req.new_password)
    for u in users:
        u.hashed_password = new_hash
    reset_token.used = True

    # Invalidate all other reset tokens for ALL user accounts with this email
    query = select(PasswordResetToken).where(
        PasswordResetToken.user_id.in_(user_ids),
        PasswordResetToken.id != reset_token.id,
    )
    result = await session.execute(query)
    other_tokens = result.scalars().all()
    for token in other_tokens:
        token.used = True

    await session.commit()

    return {
        "success": True,
        "message": "Password has been reset successfully. Please login with your new password.",
    }


@router.post("/change-password")
@limiter.limit("5/hour")
async def change_password(
    request: Request,
    change_req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Change password for authenticated user."""

    # Verify current password
    if not verify_password(change_req.current_password, current_user.hashed_password or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Current password is incorrect.",
        )

    # Validate new password strength
    is_valid, error_msg = validate_password_strength(change_req.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    # Prevent using the same password
    if verify_password(change_req.new_password, current_user.hashed_password or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from current password.",
        )

    # Update password
    current_user.hashed_password = get_password_hash(change_req.new_password)
    await session.commit()

    return {
        "success": True,
        "message": "Password has been changed successfully.",
    }


@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("30/minute")
async def refresh_tokens(
    request: Request,
    refresh_req: RefreshTokenRequest,
    session: AsyncSession = Depends(get_db),
):
    """Refresh access token using refresh token."""

    # Decode refresh token
    payload = decode_token(refresh_req.refresh_token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token.",
        )

    # Verify it's a refresh token
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type.",
        )

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        )

    # Get user
    query = select(User).where(User.id == int(user_id))
    result = await session.execute(query)
    user = result.scalars().first()

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive.",
        )

    # Create new access and refresh tokens
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    new_refresh_token = create_refresh_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
    )

    return TokenResponse(
        access_token=access_token,
        refresh_token=new_refresh_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


# ─── Admin: Reset another user's password ────────────────────────

from pydantic import BaseModel as _BaseModel

class _AdminResetRequest(_BaseModel):
    user_email: str
    new_password: str


@router.post("/admin/reset-user-password")
async def admin_reset_user_password(
    body: _AdminResetRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Admin endpoint: reset another user's password in the same company.
    Requires the caller to be an ADMIN."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can reset other users' passwords.",
        )

    # Find the target user in the same company
    query = select(User).where(
        User.email == body.user_email.strip().lower(),
        User.company_id == current_user.company_id,
    )
    result = await session.execute(query)
    target_user = result.scalars().first()

    if not target_user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found in your company.",
        )

    # Validate password strength
    is_valid, error_msg = validate_password_strength(body.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )

    # Reset the password
    target_user.hashed_password = get_password_hash(body.new_password)
    await session.commit()

    logger.info(
        f"Admin {current_user.email} reset password for {target_user.email} "
        f"(company_id={current_user.company_id})"
    )

    return {
        "success": True,
        "message": f"Password reset for {target_user.email}",
    }
