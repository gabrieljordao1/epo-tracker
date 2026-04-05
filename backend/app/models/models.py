from datetime import datetime
from enum import Enum
from sqlalchemy import Column, Integer, String, Text, DateTime, Boolean, Float, ForeignKey, Enum as SQLEnum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from ..core.database import Base


class UserRole(str, Enum):
    """User role enumeration"""
    ADMIN = "admin"
    MANAGER = "manager"
    FIELD = "field"


class Industry(str, Enum):
    """Industry / trade enumeration"""
    PAINT_DRYWALL = "paint_drywall"
    PAINT = "paint"
    DRYWALL = "drywall"
    FLOORING = "flooring"
    PLUMBING = "plumbing"
    ELECTRICAL = "electrical"
    SIDING = "siding"
    FRAMING = "framing"
    HVAC = "hvac"
    ROOFING = "roofing"
    LANDSCAPING = "landscaping"
    CONCRETE = "concrete"
    INSULATION = "insulation"
    CABINETS = "cabinets"
    COUNTERTOPS = "countertops"
    WINDOWS = "windows"
    GUTTERS = "gutters"
    GENERAL = "general"
    OTHER = "other"


class PlanTier(str, Enum):
    """Plan tier enumeration"""
    STARTER = "starter"
    PRO = "pro"
    ENTERPRISE = "enterprise"


class EPOStatus(str, Enum):
    """EPO status enumeration"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    DENIED = "denied"
    DISCOUNT = "discount"


class FollowupStatus(str, Enum):
    """Followup status enumeration"""
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"


class Company(Base):
    """Company model"""
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    industry = Column(SQLEnum(Industry), nullable=False)
    plan_tier = Column(SQLEnum(PlanTier), default=PlanTier.STARTER, nullable=False)
    invite_code = Column(String(20), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    users = relationship("User", back_populates="company", cascade="all, delete-orphan")
    epos = relationship("EPO", back_populates="company", cascade="all, delete-orphan")
    email_connections = relationship("EmailConnection", back_populates="company", cascade="all, delete-orphan")


class User(Base):
    """User model"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    work_email = Column(String(255), unique=True, nullable=True, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.FIELD, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="users")
    epos = relationship("EPO", back_populates="created_by")
    community_assignments = relationship("CommunityAssignment", back_populates="supervisor", cascade="all, delete-orphan")


class EmailConnection(Base):
    """Email connection model"""
    __tablename__ = "email_connections"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    connected_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    email_address = Column(String(255), nullable=False)
    provider = Column(String(50), nullable=False)  # gmail, outlook, imap
    is_active = Column(Boolean, default=True, nullable=False)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)

    # OAuth tokens (encrypted in production)
    access_token = Column(String(1024), nullable=True)
    refresh_token = Column(String(1024), nullable=True)
    token_expires_at = Column(DateTime(timezone=True), nullable=True)

    # Gmail watch tracking
    gmail_history_id = Column(String(255), nullable=True)
    watch_expiration = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="email_connections")
    epos = relationship("EPO", back_populates="email_connection")


class EPO(Base):
    """EPO (Extra Purchase Order) model — tracks extra work orders from any vendor trade."""
    __tablename__ = "epos"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    email_connection_id = Column(Integer, ForeignKey("email_connections.id"), nullable=True)

    vendor_name = Column(String(255), nullable=False)
    vendor_email = Column(String(255), nullable=False)
    community = Column(String(255), nullable=True)
    lot_number = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=True)
    status = Column(SQLEnum(EPOStatus), default=EPOStatus.PENDING, nullable=False)
    confirmation_number = Column(String(255), nullable=True)
    days_open = Column(Integer, nullable=True)
    needs_review = Column(Boolean, default=False, nullable=False)
    confidence_score = Column(Float, nullable=True)
    parse_model = Column(String(50), nullable=True)  # regex, gemini, haiku

    raw_email_subject = Column(String(500), nullable=True)
    raw_email_body = Column(Text, nullable=True)
    synced_from_email = Column(Boolean, default=False, nullable=False)
    vendor_token = Column(String(64), unique=True, nullable=True, index=True)

    # Gmail thread tracking for reply intelligence
    gmail_thread_id = Column(String(255), nullable=True, index=True)
    gmail_message_id = Column(String(255), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="epos")
    created_by = relationship("User", back_populates="epos")
    email_connection = relationship("EmailConnection", back_populates="epos")
    followups = relationship("EPOFollowup", back_populates="epo", cascade="all, delete-orphan")


class EPOFollowup(Base):
    """EPO Followup model"""
    __tablename__ = "epo_followups"

    id = Column(Integer, primary_key=True, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)

    sent_to_email = Column(String(255), nullable=False)
    subject = Column(String(255), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(SQLEnum(FollowupStatus), default=FollowupStatus.PENDING, nullable=False)
    sent_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    epo = relationship("EPO", back_populates="followups")
    company = relationship("Company")


class VendorAction(Base):
    """Tracks actions vendors take through the self-service portal."""
    __tablename__ = "vendor_actions"

    id = Column(Integer, primary_key=True, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)

    action_type = Column(String(50), nullable=False)  # viewed, confirmed, disputed, document_uploaded
    vendor_note = Column(Text, nullable=True)
    confirmation_number = Column(String(255), nullable=True)
    ip_address = Column(String(45), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    epo = relationship("EPO", backref="vendor_actions")
    company = relationship("Company")


class CommunityAssignment(Base):
    """Maps supervisors to the communities they manage"""
    __tablename__ = "community_assignments"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    supervisor_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    community_name = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    supervisor = relationship("User", back_populates="community_assignments")


class WebhookLog(Base):
    """Tracks incoming webhook notifications"""
    __tablename__ = "webhook_logs"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    source = Column(String(50), nullable=False)  # gmail, outlook, etc.
    payload_hash = Column(String(64), nullable=False)  # SHA-256 hash of payload
    status = Column(String(50), nullable=False)  # received, processing, completed, failed
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)

    # Relationships
    company = relationship("Company")
