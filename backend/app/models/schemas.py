from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field

from .models import UserRole, EPOStatus, FollowupStatus, Industry, PlanTier


# ===== Company Schemas =====
class CompanyBase(BaseModel):
    name: str
    industry: Industry
    plan_tier: PlanTier = PlanTier.STARTER


class CompanyCreate(CompanyBase):
    pass


class CompanyResponse(CompanyBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True


# ===== User Schemas =====
class UserBase(BaseModel):
    email: EmailStr
    full_name: str


class UserCreate(UserBase):
    password: str


class UserResponse(UserBase):
    id: int
    company_id: int
    role: UserRole
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True


class UserInDB(UserResponse):
    hashed_password: str


# ===== Auth Schemas =====
class TokenResponse(BaseModel):
    access_token: str
    refresh_token: Optional[str] = None
    token_type: str = "bearer"
    user: UserResponse


class RegisterRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    company_name: str = ""  # Not required when joining via invite code
    industry: Industry = Industry.GENERAL  # Not required when joining
    role: str = "field"  # "field" or "manager"
    invite_code: Optional[str] = None  # Join existing company


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    code: str  # 6-digit reset code
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class RefreshTokenRequest(BaseModel):
    refresh_token: str


# ===== Email Connection Schemas =====
class EmailConnectionBase(BaseModel):
    email_address: EmailStr
    provider: str  # gmail, outlook, imap


class EmailConnectionCreate(EmailConnectionBase):
    pass


class EmailConnectionResponse(EmailConnectionBase):
    id: int
    company_id: int
    is_active: bool
    last_sync_at: Optional[datetime]
    created_at: datetime

    class Config:
        from_attributes = True


# ===== EPO Schemas =====
class EPOBase(BaseModel):
    vendor_name: str
    vendor_email: EmailStr
    community: Optional[str] = None
    lot_number: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = Field(None, ge=0, le=10_000_000)
    confirmation_number: Optional[str] = None


class EPOCreate(EPOBase):
    status: Optional[EPOStatus] = EPOStatus.PENDING


class EPOUpdate(BaseModel):
    vendor_name: Optional[str] = None
    vendor_email: Optional[EmailStr] = None
    community: Optional[str] = None
    lot_number: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = Field(None, ge=0, le=10_000_000)
    confirmation_number: Optional[str] = None
    status: Optional[EPOStatus] = None
    needs_review: Optional[bool] = None
    version: Optional[int] = None  # For optimistic locking — send current version to prevent lost updates


class EPOResponse(BaseModel):
    """Response schema — no validation constraints on amount so bad DB data
    doesn't crash the entire list endpoint with a Pydantic ValidationError."""
    id: int
    company_id: int
    vendor_name: str
    vendor_email: str  # plain str, not EmailStr — bad data shouldn't crash reads
    community: Optional[str] = None
    lot_number: Optional[str] = None
    description: Optional[str] = None
    amount: Optional[float] = None  # No ge/le — display whatever is in the DB
    confirmation_number: Optional[str] = None
    status: EPOStatus
    needs_review: bool
    confidence_score: Optional[float] = None
    parse_model: Optional[str] = None
    synced_from_email: bool = False
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class EPODetailResponse(EPOResponse):
    raw_email_subject: Optional[str] = None
    raw_email_body: Optional[str] = None
    days_open: Optional[int] = None
    followups: List["EPOFollowupResponse"] = []


# ===== EPO Followup Schemas =====
class EPOFollowupBase(BaseModel):
    sent_to_email: EmailStr
    subject: str
    body: str


class EPOFollowupCreate(EPOFollowupBase):
    pass


class EPOFollowupResponse(BaseModel):
    """Response schema — no EmailStr validation so bad data doesn't crash reads."""
    id: int
    epo_id: int
    company_id: int
    sent_to_email: str  # plain str for reads
    subject: str
    body: str
    status: FollowupStatus
    sent_at: Optional[datetime] = None
    created_at: datetime

    class Config:
        from_attributes = True


# ===== Dashboard Stats Schemas =====
class EPOStats(BaseModel):
    total_epos: int
    pending_count: int
    confirmed_count: int
    denied_count: int
    discount_count: int
    needs_review_count: int
    average_amount: Optional[float]
    total_amount: Optional[float]
    avg_days_open: Optional[float] = None


class DashboardStats(BaseModel):
    stats: EPOStats
    recent_epos: List[EPOResponse]


# ===== Demo Schemas =====
class SimulateEmailRequest(BaseModel):
    email_subject: str
    email_body: str
    vendor_email: Optional[str] = None


class SimulateEmailResponse(BaseModel):
    epo: EPOResponse
    parsed_data: dict
    parse_model: str


# ===== Webhook/Agent Schemas =====
class GmailWebhookPayload(BaseModel):
    """Google Cloud Pub/Sub push notification format"""
    message: dict  # Contains 'data' field with base64-encoded JSON
    subscription: str


class GmailHistoryData(BaseModel):
    """Decoded Gmail history message"""
    email_address: str
    history_id: str


class WebhookSetupResponse(BaseModel):
    """Response from webhook setup endpoint"""
    success: bool
    message: str
    watch_expiration: Optional[datetime] = None


class AgentProcessingResult(BaseModel):
    """Result of AI agent processing an email"""
    epo_id: int
    vendor_token: str
    confidence_score: float
    parse_model: str
    needs_review: bool
    confirmation_email_sent: bool
    created: bool


# Update forward references
EPODetailResponse.model_rebuild()
DashboardStats.model_rebuild()
