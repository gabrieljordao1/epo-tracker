from datetime import timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..core.database import get_db
from ..core.config import get_settings
from ..core.auth import (
    verify_password,
    get_password_hash,
    create_access_token,
    get_current_user,
)
from ..models.models import User, Company, UserRole, Industry
from ..models.schemas import (
    LoginRequest,
    TokenResponse,
    UserResponse,
    RegisterRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])
settings = get_settings()


@router.post("/register", response_model=TokenResponse)
async def register(
    request: RegisterRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Register a new user. If invite_code is provided, join existing company.
    Otherwise, create a new company."""
    import secrets

    # Check if user already exists
    query = select(User).where(User.email == request.email)
    result = await session.execute(query)
    if result.scalars().first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered",
        )

    if request.invite_code:
        # ── Join existing company via invite code ──
        query = select(Company).where(Company.invite_code == request.invite_code.strip().upper())
        result = await session.execute(query)
        company = result.scalars().first()
        if not company:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid invite code. Check with your manager and try again.",
            )
    else:
        # ── Create new company ──
        if not request.company_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Company name is required when creating a new account.",
            )
        invite_code = secrets.token_hex(4).upper()  # 8-char hex code like "A3F2B1C9"
        company = Company(
            name=request.company_name,
            industry=request.industry,
            plan_tier="starter",
            invite_code=invite_code,
        )
        session.add(company)
        await session.flush()

    # Create user — also set work_email so the FROM-matching works
    hashed_password = get_password_hash(request.password)
    role_map = {"field": UserRole.FIELD, "manager": UserRole.MANAGER, "admin": UserRole.ADMIN}
    user_role = role_map.get(request.role, UserRole.FIELD)
    user = User(
        email=request.email,
        work_email=request.email,  # Set work_email for EPO FROM-matching
        full_name=request.full_name,
        hashed_password=hashed_password,
        company_id=company.id,
        role=user_role,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    # Create access token
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return TokenResponse(
        access_token=access_token,
        token_type="bearer",
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    login_request: LoginRequest,
    session: AsyncSession = Depends(get_db),
) -> TokenResponse:
    """Login with email and password"""

    query = select(User).where(User.email == login_request.email)
    result = await session.execute(query)
    user = result.scalars().first()

    if not user or not verify_password(login_request.password, user.hashed_password or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive",
        )

    # Create access token
    access_token = create_access_token(
        data={"sub": str(user.id)},
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    return TokenResponse(
        access_token=access_token,
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


@router.get("/invite-code")
async def get_invite_code(
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db),
):
    """Get the company's invite code for sharing with team members."""
    import secrets
    query = select(Company).where(Company.id == current_user.company_id)
    result = await session.execute(query)
    company = result.scalars().first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Generate invite code if company doesn't have one yet (legacy companies)
    if not company.invite_code:
        company.invite_code = secrets.token_hex(4).upper()
        await session.commit()
        await session.refresh(company)

    return {
        "invite_code": company.invite_code,
        "company_name": company.name,
    }
