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
    BUSINESS = "business"
    ENTERPRISE = "enterprise"


class EPOStatus(str, Enum):
    """EPO status enumeration"""
    PENDING = "pending"
    CONFIRMED = "confirmed"
    DENIED = "denied"
    DISCOUNT = "discount"


class PortalStatus(str, Enum):
    """BuildPro/SupplyPro portal approval status"""
    UNKNOWN = "unknown"
    REQUESTED = "requested"
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    PARTIALLY_APPROVED = "partially_approved"


class ApprovalStatus(str, Enum):
    """Internal EPO approval workflow status"""
    DRAFT = "draft"
    PENDING_SUPER = "pending_super"  # Waiting for superintendent sign-off
    APPROVED = "approved"
    REJECTED = "rejected"


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
    invite_code = Column(String(32), unique=True, nullable=True, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Stripe billing
    stripe_customer_id = Column(String(255), unique=True, nullable=True, index=True)
    stripe_subscription_id = Column(String(255), unique=True, nullable=True, index=True)
    stripe_subscription_status = Column(String(50), nullable=True)  # active, past_due, canceled, etc.
    billing_email = Column(String(255), nullable=True)

    # Relationships
    users = relationship("User", back_populates="company", cascade="all, delete-orphan")
    epos = relationship("EPO", back_populates="company", cascade="all, delete-orphan")
    email_connections = relationship("EmailConnection", back_populates="company", cascade="all, delete-orphan")


class User(Base):
    """User model"""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    work_email = Column(String(255), unique=True, nullable=True, index=True)
    full_name = Column(String(255), nullable=False)
    hashed_password = Column(String(255), nullable=False)
    role = Column(SQLEnum(UserRole), default=UserRole.FIELD, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    email_verified = Column(Boolean, default=False, nullable=False, server_default="false")
    email_verification_code = Column(String(6), nullable=True)  # 6-digit code
    email_verification_expires = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="users")
    epos = relationship("EPO", back_populates="created_by")
    community_assignments = relationship("CommunityAssignment", back_populates="supervisor", cascade="all, delete-orphan")


class EmailConnection(Base):
    """Email connection model"""
    __tablename__ = "email_connections"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
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
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    email_connection_id = Column(Integer, ForeignKey("email_connections.id"), nullable=True)

    vendor_name = Column(String(255), nullable=False)
    vendor_email = Column(String(255), nullable=False)
    community = Column(String(255), nullable=True)
    lot_number = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    amount = Column(Float, nullable=True)
    status = Column(SQLEnum(EPOStatus), default=EPOStatus.PENDING, nullable=False, index=True)
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

    # BuildPro / SupplyPro portal tracking
    portal_status = Column(SQLEnum(PortalStatus), default=PortalStatus.UNKNOWN, nullable=False)
    portal_confirmation_number = Column(String(255), nullable=True)
    portal_source = Column(String(50), nullable=True)  # buildpro, supplypro, manual
    portal_checked_at = Column(DateTime(timezone=True), nullable=True)
    portal_notes = Column(Text, nullable=True)

    # Internal approval workflow
    approval_status = Column(SQLEnum(ApprovalStatus), default=ApprovalStatus.DRAFT, nullable=False)

    # Optimistic locking: version increments on each update to prevent lost writes
    version = Column(Integer, default=1, nullable=False, server_default="1")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company", back_populates="epos")
    created_by = relationship("User", back_populates="epos")
    email_connection = relationship("EmailConnection", back_populates="epos")
    followups = relationship("EPOFollowup", back_populates="epo", cascade="all, delete-orphan")
    attachments = relationship("EPOAttachment", back_populates="epo", cascade="all, delete-orphan")
    approvals = relationship("EPOApproval", back_populates="epo", cascade="all, delete-orphan")
    sub_payments = relationship("SubPayment", back_populates="epo", cascade="all, delete-orphan")


class EPOFollowup(Base):
    """EPO Followup model"""
    __tablename__ = "epo_followups"

    id = Column(Integer, primary_key=True, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False, index=True)
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
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False, index=True)
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


class EPOAttachment(Base):
    """Photo/file attachments on EPOs — stored in Supabase Storage"""
    __tablename__ = "epo_attachments"

    id = Column(Integer, primary_key=True, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    uploaded_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    filename = Column(String(255), nullable=False)
    file_url = Column(String(1024), nullable=False)  # Supabase public URL or signed URL
    file_size = Column(Integer, nullable=True)  # bytes
    mime_type = Column(String(100), nullable=True)
    description = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    epo = relationship("EPO", back_populates="attachments")
    company = relationship("Company")


class EPOApproval(Base):
    """Internal approval workflow — superintendent sign-off before sending to builder"""
    __tablename__ = "epo_approvals"

    id = Column(Integer, primary_key=True, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    approved_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    status = Column(SQLEnum(ApprovalStatus), default=ApprovalStatus.PENDING_SUPER, nullable=False)
    note = Column(Text, nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    epo = relationship("EPO", back_populates="approvals")
    company = relationship("Company")
    requested_by = relationship("User", foreign_keys=[requested_by_id])
    approved_by = relationship("User", foreign_keys=[approved_by_id])


class NotificationPreference(Base):
    """Per-user notification preferences"""
    __tablename__ = "notification_preferences"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)

    email_enabled = Column(Boolean, default=True, nullable=False)
    sms_enabled = Column(Boolean, default=False, nullable=False)
    push_enabled = Column(Boolean, default=False, nullable=False)
    phone_number = Column(String(20), nullable=True)  # For SMS via Twilio

    # What to notify on
    notify_new_epo = Column(Boolean, default=True, nullable=False)
    notify_status_change = Column(Boolean, default=True, nullable=False)
    notify_approval_needed = Column(Boolean, default=True, nullable=False)
    notify_overdue = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    user = relationship("User")
    company = relationship("Company")


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


class PasswordResetToken(Base):
    """Password reset tokens for forgot password flow"""
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    token_hash = Column(String(255), nullable=False, index=True)  # Hashed version of reset code
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    user = relationship("User")


class WeatherCondition(str, Enum):
    """Weather condition for daily reports"""
    SUNNY = "sunny"
    CLOUDY = "cloudy"
    RAINY = "rainy"
    STORMY = "stormy"
    SNOWY = "snowy"
    WINDY = "windy"
    HOT = "hot"
    COLD = "cold"


class ReportStatus(str, Enum):
    """Daily report status"""
    DRAFT = "draft"
    SUBMITTED = "submitted"


class DailyReport(Base):
    """Daily field report — what happened at a community/lot today"""
    __tablename__ = "daily_reports"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    report_date = Column(DateTime(timezone=True), nullable=False, index=True)
    community = Column(String(255), nullable=False, index=True)
    lot_number = Column(String(255), nullable=True)

    # Work summary
    work_performed = Column(Text, nullable=True)  # Free-text description
    phase = Column(String(100), nullable=True)  # e.g., "Drywall Hang", "Texture", "Prime", "Paint", "Touch-up"
    units_completed = Column(Integer, nullable=True)  # Number of lots/units completed
    percent_complete = Column(Float, nullable=True)  # Overall phase progress 0-100

    # Crew info
    crew_size = Column(Integer, nullable=True)
    crew_hours = Column(Float, nullable=True)  # Total man-hours

    # Conditions
    weather = Column(SQLEnum(WeatherCondition), nullable=True)
    temperature_high = Column(Integer, nullable=True)
    work_delayed = Column(Boolean, default=False, nullable=False)
    delay_reason = Column(Text, nullable=True)

    # Issues & safety
    issues_noted = Column(Text, nullable=True)
    safety_incidents = Column(Boolean, default=False, nullable=False)
    safety_notes = Column(Text, nullable=True)

    # Materials
    materials_needed = Column(Text, nullable=True)
    materials_delivered = Column(Text, nullable=True)

    # Quality
    inspections_passed = Column(Integer, nullable=True)
    inspections_failed = Column(Integer, nullable=True)
    rework_needed = Column(Text, nullable=True)

    # Meta
    status = Column(SQLEnum(ReportStatus), default=ReportStatus.DRAFT, nullable=False)
    notes = Column(Text, nullable=True)  # Additional notes

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    created_by = relationship("User")


class PunchPriority(str, Enum):
    """Punch item priority"""
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class PunchStatus(str, Enum):
    """Punch item status"""
    OPEN = "open"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    VERIFIED = "verified"  # Inspected and approved
    REJECTED = "rejected"  # Fix attempt rejected, needs redo


class PunchCategory(str, Enum):
    """Punch item category for paint/drywall"""
    DRYWALL_DAMAGE = "drywall_damage"
    DRYWALL_FINISH = "drywall_finish"
    PAINT_TOUCH_UP = "paint_touch_up"
    PAINT_COLOR = "paint_color"
    TEXTURE_ISSUE = "texture_issue"
    NAIL_POP = "nail_pop"
    CRACK = "crack"
    SCUFF_MARK = "scuff_mark"
    MISSED_AREA = "missed_area"
    CAULKING = "caulking"
    TRIM_ISSUE = "trim_issue"
    CEILING = "ceiling"
    MOISTURE_DAMAGE = "moisture_damage"
    OTHER = "other"


class PunchItem(Base):
    """Punch list item — deficiency that needs fixing before closeout"""
    __tablename__ = "punch_items"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    community = Column(String(255), nullable=False, index=True)
    lot_number = Column(String(255), nullable=False, index=True)
    location = Column(String(255), nullable=True)  # e.g., "Master Bedroom", "Kitchen", "Garage"

    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(SQLEnum(PunchCategory), default=PunchCategory.OTHER, nullable=False)
    priority = Column(SQLEnum(PunchPriority), default=PunchPriority.MEDIUM, nullable=False)
    status = Column(SQLEnum(PunchStatus), default=PunchStatus.OPEN, nullable=False, index=True)

    # Builder/vendor info (who reported it)
    reported_by = Column(String(255), nullable=True)  # Builder name or superintendent
    builder_name = Column(String(255), nullable=True)

    # Resolution
    resolution_notes = Column(Text, nullable=True)
    completed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    verified_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    verified_at = Column(DateTime(timezone=True), nullable=True)

    # Scheduling
    due_date = Column(DateTime(timezone=True), nullable=True)
    scheduled_date = Column(DateTime(timezone=True), nullable=True)

    # Photo references (store URLs)
    photo_url = Column(String(1024), nullable=True)
    completion_photo_url = Column(String(1024), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    created_by = relationship("User", foreign_keys=[created_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    completed_by = relationship("User", foreign_keys=[completed_by_id])
    verified_by = relationship("User", foreign_keys=[verified_by_id])


class CommunityBudget(Base):
    """Budget allocation per community — tracks planned vs actual EPO spend"""
    __tablename__ = "community_budgets"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    community = Column(String(255), nullable=False, index=True)
    budget_amount = Column(Float, nullable=False)  # Total budget for this community
    period_start = Column(DateTime(timezone=True), nullable=False)
    period_end = Column(DateTime(timezone=True), nullable=False)

    # Budget breakdown by category (optional)
    labor_budget = Column(Float, nullable=True)
    materials_budget = Column(Float, nullable=True)
    equipment_budget = Column(Float, nullable=True)

    notes = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    created_by = relationship("User")


class WorkOrderPriority(str, Enum):
    """Work order priority"""
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    URGENT = "urgent"


class WorkOrderStatus(str, Enum):
    """Work order status"""
    OPEN = "open"
    ASSIGNED = "assigned"
    IN_PROGRESS = "in_progress"
    ON_HOLD = "on_hold"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class WorkOrderType(str, Enum):
    """Work order type for paint/drywall"""
    DRYWALL_HANG = "drywall_hang"
    DRYWALL_FINISH = "drywall_finish"
    TEXTURE = "texture"
    PRIME = "prime"
    PAINT = "paint"
    TOUCH_UP = "touch_up"
    PUNCH_WORK = "punch_work"
    WARRANTY = "warranty"
    REPAIR = "repair"
    INSPECTION = "inspection"
    OTHER = "other"


class WorkOrder(Base):
    """Work order — task assigned to field crew"""
    __tablename__ = "work_orders"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    assigned_to_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)

    title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    community = Column(String(255), nullable=False, index=True)
    lot_number = Column(String(255), nullable=True)

    work_type = Column(SQLEnum(WorkOrderType), default=WorkOrderType.OTHER, nullable=False)
    priority = Column(SQLEnum(WorkOrderPriority), default=WorkOrderPriority.NORMAL, nullable=False)
    status = Column(SQLEnum(WorkOrderStatus), default=WorkOrderStatus.OPEN, nullable=False, index=True)

    # Scheduling
    scheduled_date = Column(DateTime(timezone=True), nullable=True)
    due_date = Column(DateTime(timezone=True), nullable=True)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Crew/effort
    estimated_hours = Column(Float, nullable=True)
    actual_hours = Column(Float, nullable=True)
    crew_size_needed = Column(Integer, nullable=True)

    # Cost
    estimated_cost = Column(Float, nullable=True)
    actual_cost = Column(Float, nullable=True)

    # Builder info
    builder_name = Column(String(255), nullable=True)
    builder_contact = Column(String(255), nullable=True)

    # Linked EPO (if work order comes from an EPO)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=True, index=True)

    # Completion
    completion_notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    created_by = relationship("User", foreign_keys=[created_by_id])
    assigned_to = relationship("User", foreign_keys=[assigned_to_id])
    epo = relationship("EPO")


# ─── Sub Payments / Profit Tracking ──────────────────────────────────
class SubPayment(Base):
    """Tracks payments made to subcontractors (drywaller, painter, etc.)
    against an EPO. Used to calculate net profit per EPO.
    """
    __tablename__ = "sub_payments"

    id = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    epo_id = Column(Integer, ForeignKey("epos.id"), nullable=False, index=True)
    created_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    sub_name = Column(String(255), nullable=False)
    sub_trade = Column(String(100), nullable=False)  # drywaller, painter, etc.
    amount = Column(Float, nullable=False)
    paid_date = Column(DateTime(timezone=True), nullable=True)
    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False, index=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    # Relationships
    company = relationship("Company")
    epo = relationship("EPO", back_populates="sub_payments")
    created_by = relationship("User", foreign_keys=[created_by_id])
